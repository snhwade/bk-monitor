<!--
* Tencent is pleased to support the open source community by making
* 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
*
* Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
*
* 蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
*
* License for 蓝鲸智云PaaS平台 (BlueKing PaaS):
*
* ---------------------------------------------------
* Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
* documentation files (the "Software"), to deal in the Software without restriction, including without limitation
* the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
* to permit persons to whom the Software is furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all copies or substantial portions of
* the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
* THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
* CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
* IN THE SOFTWARE.
-->
<template>
  <div class="card">
    <h4
      class="card__title"
      @click="clickHandle"
      :title="title"
      :style="{ borderLeftColor: seriesDataMap[level].color }"
    >
      {{ title || 'Title' }}
    </h4>
    <div
      class="card__content"
      v-if="options"
      v-bkloading="{ isLoading: isLoading }"
    >
      <monitor-eacharts
        v-if="seriesData.length"
        height="36"
        :options="options"
        @click="clickHandle"
        :unit="valueSuffix"
        :series="seriesData"
      />
      <span
        class="error-content"
        v-else
        @click="clickHandle"
        :title="message"
      >{{ message }}</span>
    </div>
  </div>
</template>

<script>
import moment from 'moment';

// import { graphPoint } from '../../../../../monitor-api/modules/alert_events';
import { alertGraphQuery } from '../../../../../monitor-api/modules/alert';
import MonitorEacharts from '../../../../../monitor-ui/monitor-echarts/monitor-echarts';
import { gotoPageMixin } from '../../../../common/mixins';

export default {
  name: 'BusinessAlarmCard',
  components: {
    MonitorEacharts
  },
  mixins: [gotoPageMixin],
  inject: ['homeItemBizId'],
  props: {
    alarm: {
      type: Object,
      default() {
        return {};
      }
    },
    id: null,
    title: {
      type: String,
      default: ''
    },
    level: {
      type: [String, Number],
      default: '1'
    }
  },
  data() {
    return {
      observer: null,
      needObserver: true,
      styles: {
        width: 210,
        height: 37
      },
      valueSuffix: '',
      seriesData: [],
      alarmYAxis: [],
      isLoading: false,
      message: this.$t('无数据'),
      seriesDataMap: {
        1: {
          name: this.$t('致命告警'),
          color: '#EA3636'
        },
        2: {
          name: this.$t('预警告警'),
          color: '#FF9C01'
        },
        3: {
          name: this.$t('提醒告警'),
          color: '#FFD000'
        }
      }
    };
  },
  computed: {
    options() {
      return {
        color: [this.seriesDataMap[this.level].color],
        legend: {
          show: false
        },
        xAxis: {
          splitLine: {
            show: false
          },
          axisTick: {
            show: false
          },
          axisLabel: {
            show: false
          },
          boundaryGap: false
        },
        grid: {
          containLabel: false,
          left: 5,
          right: 5,
          top: 5,
          bottom: 5,
          backgroundColor: 'transparent'
        },
        yAxis: {
          scale: false,
          min: 0,
          splitLine: {
            show: false
          },
          axisTick: {
            show: false
          },
          axisLabel: {
            show: false
          }
        },
        tooltip: {
          appendToBody: true
        }
      };
    }
  },
  mounted() {
    this.registerObserver();
    this.observer.unobserve(this.$el);
    this.observer.observe(this.$el);
  },
  beforeDestroy() {
    this.observer.unobserve(this.$el);
    this.observer.disconnect();
  },
  methods: {
    registerObserver() {
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.intersectionRatio > 0 && this.needObserver) {
            this.getAlarmChatData();
          }
        });
      });
    },
    getAlarmChatData() {
      this.observer.unobserve(this.$el);
      this.observer.disconnect();
      this.needObserver = false;
      this.isLoading = true;
      alertGraphQuery({
        ...(this.homeItemBizId ? { bk_biz_id: this.homeItemBizId } : {}),
        id: this.id,
        chart_type: 'main',
        time_range: `${moment().add(-1, 'day')
          .format('YYYY-MM-DD HH:mm:ss')} -- ${moment().format('YYYY-MM-DD HH:mm:ss')}`,
        functions: [],
        expression: ''
      }, {
        needTraceId: false,
        needMessage: false
      })
        .then(({ series = [] }) => {
          this.valueSuffix = series[0]?.unit === 'none' ? '' : series[0]?.unit;
          setTimeout(() => {
            this.seriesData = series.map((item) => {
              const { datapoints, target, markPoints } = item;
              const data = [];
              if (datapoints?.length) {
                datapoints.forEach((i, j) => {
                  data[j] = [i[1], i[0]];
                });
              }
              return {
                name: target,
                data,
                markPoints,
                lineStyle: {
                  width: 1
                },
                areaStyle: {
                  opacity: 0.25
                }
              };
            });
          }, 30);
        })
        .catch((e) => {
          this.seriesData = [];
          this.message = e.message || this.$t('数据拉取异常');
        })
        .finally(() => {
          this.isLoading = false;
        });
    },
    clickHandle() {
      const query = `?queryString=id : ${this.alarm.event_id}&from=now-${this.homeDays || 7}d&to=now`;
      const url = `${location.origin}${location.pathname}?bizId=${this.homeItemBizId}#/event-center${query}`;
      window.open(url);
    }
  }
};
</script>

<style scoped lang="scss">
@import '../../common/mixins';

.card {
  padding: 4px 0 20px 0;

  &__title {
    font-size: 12px;
    color: $defaultFontColor;
    padding-left: 6px;
    border-left: 2px solid #a3c5fd;
    text-align: left;
    margin: 0 0 10px 0;
    max-width: 208px;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;

    @include hover();
  }

  &__content {
    min-width: 210px;
    min-height: 37px;
    overflow: auto;
    background: #fafbfd;
    text-align: center;
    line-height: 37px;
    font-weight: bold;

    .error-content {
      display: block;
      width: 100%;
      max-width: 208px;
      height: 100%;
      text-overflow: ellipsis;
      overflow: hidden;
      white-space: nowrap;

      @include hover();
    }
  }
}
</style>
