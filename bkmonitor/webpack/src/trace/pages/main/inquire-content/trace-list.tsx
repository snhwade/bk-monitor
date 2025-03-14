/* eslint-disable codecc/comment-ratio */
/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台社区版 (BlueKing PaaS Community Edition) available.
 *
 * Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
 *
 * 蓝鲸智云PaaS平台社区版 (BlueKing PaaS Community Edition) is licensed under the MIT License.
 *
 * License for 蓝鲸智云PaaS平台社区版 (BlueKing PaaS Community Edition):
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
 */
import {
  computed,
  defineComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  PropType,
  provide,
  reactive,
  ref,
  toRefs,
  watch
} from 'vue';
import { useRoute } from 'vue-router';
import { Checkbox, Dialog, Loading, Popover, Radio, Table } from 'bkui-vue';
import { addListener, removeListener } from 'resize-detector';

import { CancelToken } from '../../../../monitor-api/index';
import { listOptionValues, spanDetail, traceDetail } from '../../../../monitor-api/modules/apm_trace';
import { random } from '../../../../monitor-common/utils/utils';
import EmptyStatus from '../../../components/empty-status/empty-status';
import { handleTransformToTimestamp } from '../../../components/time-range/utils';
import transformTraceTree from '../../../components/trace-view/model/transform-trace-data';
import { formatDate, formatDuration, formatTime } from '../../../components/trace-view/utils/date';
import TimeSeries from '../../../plugins/charts/time-series/time-series';
import { useTimeRanceInject } from '../../../plugins/hooks';
import { PanelModel } from '../../../plugins/typings';
import { SPAN_KIND_MAPS } from '../../../store/constant';
import { useSearchStore } from '../../../store/modules/search';
import { ListType, useTraceStore } from '../../../store/modules/trace';
import { IAppItem, ISpanListItem, ITraceListItem } from '../../../typings';
import SpanDetails from '../span-details';

import InterfaceStatistics from './interface-statistics';
import ServiceStatistics from './service-statistics';
import TraceDetail from './trace-detail';

import './trace-list.scss';

type AliasMapType = {
  [key: string]: string;
};

const fieldQueryKeyMaps: AliasMapType = {
  entryService: 'root_service',
  entryEndpoint: 'root_service_span_name',
  statusCode: 'root_service_status_code',
  type: 'root_service_category',
  service_name: 'resource.service.name',
  status_code: 'status.code'
};

const TRACE_TABLE_ROW_HEIGHR = 60; // trace 表格行高

enum TraceFilter {
  Error = 'error'
}

enum SpanFilter {
  RootSpan = 'root_span',
  EntrySpan = 'entry_span',
  // 第二期：后端未提供该参数，先占个位。
  ThirdPart = '3',
  Error = 'error'
}

enum InterfaceStatisticsFilter {
  RootSpan = 'root_span',
  RootServiceSpan = 'root_service_span',
  StatusCode = 'status.code'
}

enum ServiceStatisticsFilter {
  Error = 'error'
}

export type TraceListType = {
  // 属于 Trace 列表的
  root_service: any[];
  root_service_span_name: any[];
  root_service_status_code: any[];
  root_service_category: any[];
  root_span_name: any[];
  // 属于 Span 列表的
  kind: any[];
  'resource.bk.instance.id': any[];
  'resource.service.name': any[];
  'resource.telemetry.sdk.version': any[];
  span_name: any[];
  'status.code': any[];
};

export default defineComponent({
  name: 'TraceList',
  props: {
    tableLoading: {
      type: Boolean,
      default: false
    },
    appName: {
      type: String,
      required: true
    },
    appList: {
      type: Array as PropType<IAppItem[]>,
      default: () => []
    }
  },
  emits: [
    'scrollBottom',
    'statusChange',
    'sortChange',
    'columnFilterChange',
    'listTypeChange',
    'columnSortChange',
    'traceTypeChange',
    'spanTypeChange',
    'interfaceStatisticsChange',
    'serviceStatisticsChange'
  ],
  setup(props, { emit }) {
    /** 取消请求方法 */
    let searchCancelFn = () => {};
    const route = useRoute();
    const store = useTraceStore();
    const searchStore = useSearchStore();
    const statusList = [
      { id: 'have_root_span', name: 'root span', tips: window.i18n.t('包含根span的trace') },
      { id: 'have_service_span', name: 'entry span', tips: window.i18n.t('包含至少一个服务的trace') }
    ];
    const state = reactive({
      total: 24,
      duration: 207,
      collapseActive: true,
      currentStatus: 'all'
    });
    const traceTableMain = ref<HTMLDivElement>();
    const traceListWrapper = ref<HTMLDivElement>();
    const chartContent = ref<HTMLDivElement>();
    const traceTableElem = ref<HTMLDivElement>();
    const traceTableContainer = ref<HTMLDivElement>();
    const traceDetailElem = ref(TraceDetail);
    const isFullscreen = ref(false);
    const height = ref<number>(0);
    const curTraceId = ref<string>('');
    const curTraceIndex = ref<number>(-1);
    const renderKey = ref<string>(random(6));
    const shouldResetTable = ref<boolean>(false);
    const columnFilters = ref<Record<string, string[]>>({});
    const selectedTraceType = ref([]);
    const selectedSpanType = ref([]);

    const selectedInterfaceStatisticsType = ref([]);
    const selectedInterfaceTypeInInterfaceStatistics = ref([]);
    const interfaceTypeListInInterfaceStatistics = ref([
      {
        label: '同步',
        value: window.i18n.t('同步')
      },
      {
        label: '异步',
        value: window.i18n.t('异步')
      },
      {
        label: '内部调用',
        value: window.i18n.t('内部调用')
      },
      {
        label: '未知',
        value: window.i18n.t('未知')
      }
    ]);
    const selectedSourceTypeInInterfaceStatistics = ref([]);
    const sourceTypeListInInterfaceStatistics = ref([
      {
        label: 'OTel',
        value: 'OTel'
      },
      {
        label: 'eBPF',
        value: 'eBPF'
      }
    ]);

    const selectedServiceStatisticsType = ref([]);
    const selectedInterfaceTypeInServiceStatistics = ref([]);
    const interfaceTypeListInServiceStatistics = ref([
      {
        label: window.i18n.t('同步'),
        value: 'sync'
      },
      {
        label: window.i18n.t('异步'),
        value: 'async'
      },
      {
        label: window.i18n.t('内部调用'),
        value: 'internal'
      },
      {
        label: window.i18n.t('未知'),
        value: 'unknown'
      }
    ]);
    const selectedSourceTypeInServiceStatistics = ref([]);
    const sourceTypeListInServiceStatistics = ref([
      {
        label: 'OTel',
        value: 'OTel'
      },
      {
        label: 'eBPF',
        value: 'eBPF'
      }
    ]);

    const timeRange = useTimeRanceInject();
    provide('isFullscreen', isFullscreen);

    const selectedListType = computed(() => store.listType);
    /* 表格数据 */
    const tableData = computed(() => store.traceList);
    const filterSpanTableData = computed(() => store.filterSpanList);
    const tableDataOfSpan = computed(() =>
      filterSpanTableData.value?.length ? filterSpanTableData.value : store.spanList
    );
    const filterTableData = computed(() => store.filterTraceList);
    const localTableData = computed(() => (filterTableData.value?.length ? filterTableData.value : tableData.value));
    const showTraceDetail = computed(() => store.showTraceDetail);
    const totalCount = computed(() => store.totalCount);
    const isPreCalculationMode = computed(() => store.traceListMode === 'pre_calculation');
    const tableColumns = computed(() => [
      {
        label: () => (
          <div class='trace-id-column-head'>
            <Popover
              popoverDelay={[500, 0]}
              content='trace_id'
              theme='light'
              placement='right'
            >
              <span class='th-label'>Trace ID</span>
            </Popover>
          </div>
        ),
        // settingsLabel 字段为非官方字段，这里先保留，后续优化代码会用到。20230510
        settingsLabel: 'Trace ID',
        settingsDisabled: true,
        field: 'traceID',
        width: showTraceDetail.value ? 248 : 160,
        render: ({ cell, data, index }: { cell: string; data: ITraceListItem; index: number }) => (
          <div
            class={['trace-id-column', { 'expand-row': showTraceDetail.value && cell === curTraceId.value }]}
            style={`width:${showTraceDetail.value ? '232px' : 'auto'}`}
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            onClick={() => handleTraceDetail(data.trace_id, index)}
          >
            <div
              class='trace-id link-text'
              title={cell}
            >
              {cell}
            </div>
            {/* 20230522 暂时不要 */}
            {showTraceDetail.value && (
              <div>
                <span class='duration'>{data.duration}</span>
                <span class='time'>{`${formatDate(data.time)} ${formatTime(data.time)}`}</span>
                {showTraceDetail.value && data.error && <span class='icon-monitor icon-mind-fill'></span>}
              </div>
            )}
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='min_start_time'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('开始时间')}</span>
          </Popover>
        ),
        width: 160,
        field: 'min_start_time',
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell }: { cell: number }) => (
          <div>
            <span>{`${formatDate(cell)} ${formatTime(cell)}`}</span>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content={window.i18n.t('整个Trace的第一个Span')}
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('根Span')}</span>
          </Popover>
        ),
        field: 'root_span_name',
        filter: isPreCalculationMode.value
          ? {
              list: traceListFilter.root_span_name,
              filterFn: () => true as any
              // btnSave: !!traceListFilter.root_span_name.length ? window.i18n.t('确定') : false
            }
          : false,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: string; data: ITraceListItem }) => (
          <div class='link-column'>
            <span
              class='link-text link-server'
              onClick={() => handleOpenEndpoint(cell, data?.root_service)}
            >
              <span title={cell}>{cell}</span>
            </span>
            <i class='icon-monitor icon-fenxiang'></i>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content={window.i18n.t('服务端进程的第一个Service')}
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('入口服务')}</span>
          </Popover>
        ),
        settingsLabel: `${window.i18n.t('入口服务')}`,
        field: 'entryService',
        filter: isPreCalculationMode.value
          ? {
              list: traceListFilter.root_service,
              filterFn: () => true as any
              // btnSave: !!traceListFilter.root_service.length ? window.i18n.t('确定') : false
            }
          : false,
        render: ({ cell, data }: { cell: string; data: ITraceListItem }) => [
          cell ? (
            <div class='link-column'>
              <span
                class='link-text link-server'
                onClick={() => handleOpenService(cell)}
              >
                {data.error ? <span class='icon-monitor icon-mind-fill'></span> : undefined}
                <span title={cell}>{cell}</span>
              </span>
              <i class='icon-monitor icon-fenxiang'></i>
            </div>
          ) : (
            '--'
          )
        ]
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content={window.i18n.t('入口服务的第一个接口')}
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('入口接口')}</span>
          </Popover>
        ),
        settingsLabel: `${window.i18n.t('入口接口')}`,
        field: 'root_service_span_name',
        filter: isPreCalculationMode.value
          ? {
              list: traceListFilter.root_service_span_name,
              filterFn: () => true as any
              // btnSave: !!traceListFilter.root_service_span_name.length ? window.i18n.t('确定') : false
            }
          : false,
        render: ({ cell, data }: { cell: string; data: ITraceListItem }) => [
          cell ? (
            <div class='link-column'>
              <span
                class='link-text link-server'
                onClick={() => handleOpenEndpoint(cell, data?.root_service)}
              >
                <span title={cell}>{cell}</span>
              </span>
              <i class='icon-monitor icon-fenxiang'></i>
            </div>
          ) : (
            '--'
          )
        ]
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='root_service_category'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('调用类型')}</span>
          </Popover>
        ),
        settingsLabel: `${window.i18n.t('调用类型')}`,
        field: 'root_service_category',
        width: 120,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: { text: string; value: string }; data: ITraceListItem }) => (
          <div>{cell.text || '--'}</div>
        ),
        filter: isPreCalculationMode.value
          ? {
              list: traceListFilter.root_service_category,
              filterFn: () => true as any
              // btnSave: !!traceListFilter.root_service_category.length ? window.i18n.t('确定') : false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='root_service_status_code'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('状态码')}</span>
          </Popover>
        ),
        settingsLabel: `${window.i18n.t('状态码')}`,
        width: 120,
        field: 'statusCode',
        filter: {
          list: traceListFilter.root_service_status_code,
          filterFn: () => true as any
          // btnSave: !!traceListFilter.root_service_status_code.length ? window.i18n.t('确定') : false
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: number; data: ITraceListItem }) => (
          <div class={`status-code status-${data.root_service_status_code?.type}`}>
            {data.root_service_status_code?.value || '--'}
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='trace_duration'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('耗时')}</span>
          </Popover>
        ),
        width: 120,
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false,
        settingsLabel: `${window.i18n.t('耗时')}`,
        field: 'trace_duration',
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: number; data: ITraceListItem }) => (
          <div>
            <span>{formatDuration(cell)}</span>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='kind_statistics.sync'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('同步Span数量')}</span>
          </Popover>
        ),
        // minWidth 的作用是强行撑开整个 label ，不然由于组件 bug 的存在，会导致全部字段在展示时会把这类字段内容给遮挡
        minWidth: 120,
        settingsLabel: `${window.i18n.t('同步Span数量')}`,
        field: 'kind_statistics.sync',
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='kind_statistics.async'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('异步Span数量')}</span>
          </Popover>
        ),
        minWidth: 120,
        settingsLabel: `${window.i18n.t('异步Span数量')}`,
        field: 'kind_statistics.async',
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='kind_statistics.interval'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('内部Span数量')}</span>
          </Popover>
        ),
        minWidth: 120,
        settingsLabel: `${window.i18n.t('内部Span数量')}`,
        field: 'kind_statistics.interval',
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='kind_statistics.unspecified'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('未知Span数量')}</span>
          </Popover>
        ),
        minWidth: 120,
        settingsLabel: `${window.i18n.t('未知Span数量')}`,
        field: 'kind_statistics.unspecified',
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='category_statistics.db'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('DB 数量')}</span>
          </Popover>
        ),
        settingsLabel: `${window.i18n.t('DB 数量')}`,
        field: 'category_statistics.db',
        width: 120,
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='category_statistics.messaging'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('Messaging 数量')}</span>
          </Popover>
        ),
        minWidth: 120,
        settingsLabel: `${window.i18n.t('Messaging 数量')}`,
        field: 'category_statistics.messaging',
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='category_statistics.http'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('HTTP 数量')}</span>
          </Popover>
        ),
        settingsLabel: `${window.i18n.t('HTTP 数量')}`,
        field: 'category_statistics.http',
        width: 120,
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='category_statistics.rpc'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('RPC 数量')}</span>
          </Popover>
        ),
        settingsLabel: `${window.i18n.t('RPC 数量')}`,
        field: 'category_statistics.rpc',
        width: 120,
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='category_statistics.async_backend'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('Async 数量')}</span>
          </Popover>
        ),
        minWidth: 120,
        settingsLabel: `${window.i18n.t('Async 数量')}`,
        field: 'category_statistics.async_backend',
        width: 120,
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='category_statistics.other'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('Other 数量')}</span>
          </Popover>
        ),
        settingsLabel: `${window.i18n.t('Other 数量')}`,
        field: 'category_statistics.other',
        width: 120,
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='span_count'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('Span 数量')}</span>
          </Popover>
        ),
        settingsLabel: `${window.i18n.t('Span 数量')}`,
        field: 'span_count',
        width: 120,
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='hierarchy_count'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('Span 层数')}</span>
          </Popover>
        ),
        width: 120,
        settingsLabel: `${window.i18n.t('Span 层数')}`,
        field: 'hierarchy_count',
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='service_count'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('服务数量')}</span>
          </Popover>
        ),
        width: 120,
        settingsLabel: `${window.i18n.t('服务数量')}`,
        field: 'service_count',
        sort: isPreCalculationMode.value
          ? {
              sortFn: () => false
            }
          : false
      }
    ]);
    const chartList = computed<PanelModel[]>(() => searchStore.chartPanelList);
    const isListLoading = computed<boolean>(() => store.loading);

    watch(
      () => route.query,
      () => {
        const selectedType = JSON.parse((route.query.selectedType as string) || '[]');
        const selectedInterfaceType = JSON.parse((route.query.selectedInterfaceType as string) || '[]');
        switch (store.listType) {
          case 'trace':
            selectedTraceType.value = selectedType;
            break;
          case 'span':
            selectedSpanType.value = selectedType;
            break;
          case 'interfaceStatistics':
            selectedInterfaceStatisticsType.value = selectedType;
            break;
          case 'serviceStatistics':
            selectedServiceStatisticsType.value = selectedType;
            selectedInterfaceTypeInServiceStatistics.value = selectedInterfaceType;
            break;
        }
      },
      { immediate: true }
    );

    // 当在 table header 上选择筛选并确定后执行的回调方法。
    const handleSpanFilter = (options: any) => {
      console.log(options);

      const {
        checked,
        column: { field }
      } = options;
      if (field === 'traceID') {
        // 第二期结束可以删掉该逻辑块
        const kind = checked.length > 1 || !checked.length ? 'all' : checked.toString();
        handleStatusChange(kind);
      } else {
        const key = fieldQueryKeyMaps[field] || field;
        if (columnFilters.value[key] && !checked.length) {
          delete columnFilters.value[key];
        } else if (!checked.length) {
          // 20230830由于组件不支持把 筛选的确认按钮 禁用，这里不处理未选择筛选项的情况。
          return;
        } else {
          columnFilters.value[key] = checked;
        }
        emit('columnFilterChange', columnFilters.value);
      }
    };
    const handleCollapse = () => {
      state.collapseActive = !state.collapseActive;
      nextTick(() => {
        handleClientResize();
      });
    };
    const handleStatusChange = (val: string) => {
      state.currentStatus = val;
      emit('statusChange', val);
    };
    const handleTraceDetail = async (traceId: string, index) => {
      // 当前全屏状态且点击的是当前trace
      if (traceId === curTraceId.value && isFullscreen.value) return;

      if (!isFullscreen.value) {
        // 当前未在全屏，则打开全屏弹窗
        curTraceIndex.value = index;
        isFullscreen.value = true;
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        nextTick(() => getTraceDetails(traceId));
      } else {
        // 当前在全屏下则直接请求trace详情
        getTraceDetails(traceId);
      }
    };
    const getTraceDetails = async (traceId: string) => {
      searchCancelFn();
      curTraceId.value = traceId;
      store.setTraceDetail(true);
      store.setTraceLoaidng(true);

      const params: any = {
        bk_biz_id: window.bk_biz_id,
        app_name: props.appName,
        trace_id: traceId
      };

      if (
        traceDetailElem.value?.activePanel !== 'statistics' &&
        (store.traceViewFilters.length > 1 ||
          (store.traceViewFilters.length === 1 && !store.traceViewFilters.includes('duration')))
      ) {
        const selects = store.traceViewFilters.filter(item => item !== 'duration'); // 排除 耗时 选贤
        params.displays = ['source_category_opentelemetry'].concat(selects);
      }
      await traceDetail(params, {
        cancelToken: new CancelToken((c: any) => (searchCancelFn = c))
      })
        .then(async data => {
          await store.setTraceData({ ...data, appName: props.appName, trace_id: traceId });
          store.setTraceLoaidng(false);
        })
        .catch(() => null);
    };
    const handleColseDetail = () => {
      if (!isFullscreen.value) return;
      handleDialogClose();
    };
    /** 新开页签入口服务 */
    const handleOpenService = (service: string) => {
      const hash = `#/apm/service?filter-service_name=${service}&filter-app_name=${props.appName}`;
      const url = location.href.replace(location.hash, hash);
      window.open(url, '_blank');
    };
    /** 新开页签接口 */
    const handleOpenEndpoint = (endpoint: string, service?: string) => {
      const hash = `#/apm/application?filter-service_name=${service}&filter-app_name=${props.appName}&sceneId=apm_application&sceneType=detail&dashboardId=endpoint&filter-endpoint_name=${endpoint}`;
      const url = location.href.replace(location.hash, hash);
      window.open(url, '_blank');
    };
    const handleDialogClose = () => {
      isFullscreen.value = false;
      curTraceId.value = '';
      curTraceIndex.value = -1;

      // TODO: 开发模式下会卡一下，这里设置一秒后执行可以减缓这种情况。
      setTimeout(() => {
        store.setTraceDetail(false);
      }, 1000);
    };
    const traceListFilter = reactive<TraceListType>({
      // 属于 Trace 列表的
      root_service: [],
      root_service_span_name: [],
      root_service_status_code: [],
      root_service_category: [],
      root_span_name: [],
      // 属于 Span 列表的
      kind: [],
      'resource.bk.instance.id': [],
      'resource.service.name': [],
      'resource.telemetry.sdk.version': [],
      span_name: [],
      'status.code': []
    });
    /** 获取列表表头过滤候选值 */
    const getFilterValues = () => {
      const [startTime, endTime] = handleTransformToTimestamp(timeRange?.value as string[]);
      // 由于 接口统计 的候选值和 span 视角一样，这里做一次转换。
      const modeMapping = {
        trace: 'trace',
        span: 'span',
        interfaceStatistics: 'span',
        serviceStatistics: 'span'
      };
      const params = {
        bk_biz_id: window.bk_biz_id,
        app_name: props.appName,
        start_time: startTime,
        end_time: endTime,
        mode: modeMapping[selectedListType.value]
      };
      listOptionValues(params).then(res => {
        Object.keys(res).forEach(key => {
          // 该列表是全量获取的，每次添加时需要重置一下 filter 。
          if (traceListFilter[key]?.length) traceListFilter[key].length = 0;
          traceListFilter[key]?.push(...res[key]);
        });
      });
    };
    getFilterValues();
    function handleScrollBottom(arg: { bottom: number }) {
      // TODO：这里貌似不太严谨，会导致重复调用 scrollBottotm 事件。
      if (arg.bottom <= 2) {
        /* 到底了 */
        emit('scrollBottom');
      }
    }
    function handleClientResize() {
      const containerRect = traceListWrapper.value?.getBoundingClientRect();
      const chartRect = chartContent.value?.getBoundingClientRect();
      // 剩余放置表格内容的高度
      if (containerRect && chartRect) {
        const remainHeight = containerRect?.height - chartRect?.height;
        // // 如果剩余高度大于10行高度 或 表格无数据 则表格高度自适应剩余区域
        // if (remainHeight > LIMIT_TABLE_HEIGHT || !(localTableData.value?.length)) {
        //   height.value = remainHeight - 12; // 16是 margin 距离
        // } else { // 否则
        //   height.value = LIMIT_TABLE_HEIGHT;
        // }
        height.value = remainHeight - 24; // 24是 margin padding 距离;
      }
    }
    function handleSourceData() {
      const { appList, appName } = props;
      const appId = appList.find(app => app.app_name === appName)?.application_id || '';
      if (appId) {
        const hash = `#/apm/application/config/${appId}?active=dataStatus`;
        const url = location.href.replace(location.hash, hash);
        window.open(url, '_blank');
      }
    }

    /**
     * Trace 或 Span 列表类型切换
     * 重新发起列表查询。
     */
    function handleListTypeChange(v: ListType) {
      store.setListType(v);
      selectedTraceType.value.length = 0;
      // span 类型重置
      selectedSpanType.value.length = 0;
      selectedInterfaceStatisticsType.value.length = 0;
      selectedServiceStatisticsType.value.length = 0;
      // 表头筛选重置
      columnFilters.value = {};
      store.resetTable();
      emit('listTypeChange');
      getFilterValues();
    }

    function handleTraceTypeChange(v: string[]) {
      emit('traceTypeChange', v);
    }

    function handleSpanTypeChange(v: string[]) {
      emit('spanTypeChange', v);
    }

    /**
     * 将 接口统计 下的 复选、两个多选的 onChange 事件的多合一
     */
    function handleInterfaceStatisticsChange() {
      emit('interfaceStatisticsChange', selectedInterfaceStatisticsType.value);
    }

    /**
     * 将 服务统计 下的 复选、下拉多选的 onChange 事件的多合一
     * 最后打包成一个
     */
    function handleServiceStatisticsChange() {
      // console.log('selectedInterfaceTypeInServiceStatistics', selectedInterfaceTypeInServiceStatistics.value);
      // const typeMapping = {
      //   error: {
      //     key: 'status.code',
      //     operator: 'not_equal',
      //     value: ['0']
      //   }
      // };
      // const filters = [];
      // selectedServiceStatisticsType.value.forEach(type => {
      //   filters.push(typeMapping[type]);
      // });
      // // 当 接口类型 全选时就会触发该判断，全选 就不传 接口类型 即可。
      if (selectedInterfaceTypeInServiceStatistics.value.length === interfaceTypeListInServiceStatistics.value.length) {
        emit('serviceStatisticsChange', {
          contain: selectedServiceStatisticsType.value,
          interfaceType: []
        });
        return;
      }
      emit('serviceStatisticsChange', {
        contain: selectedServiceStatisticsType.value,
        interfaceType: selectedInterfaceTypeInServiceStatistics.value
      });
    }

    watch(
      () => filterTableData.value,
      () => store.setTraceDetail(false)
    );
    watch(
      () => localTableData.value,
      () => handleClientResize(),
      { immediate: true }
    );
    watch([() => props.appName, () => timeRange?.value], () => {
      shouldResetTable.value = true;
      getFilterValues();
    });
    watch(
      () => isListLoading.value,
      () => {
        traceTableElem.value?.scrollTo?.({ top: 0 });
        if (shouldResetTable.value) {
          renderKey.value = random(6);
          shouldResetTable.value = false;
        }
      }
    );
    watch(
      () => isFullscreen.value,
      val => {
        if (val) {
          setTimeout(() => {
            // 将全屏弹窗内表格当前选中项滚动至可视区内
            traceTableElem.value?.scrollTo?.({
              top: (curTraceIndex.value - 1) * TRACE_TABLE_ROW_HEIGHR
            });
          }, 10);
        }
      }
    );

    onMounted(() => {
      handleClientResize();
      addListener(traceListWrapper.value as HTMLDivElement, handleClientResize);
    });

    onBeforeUnmount(() => {
      removeListener(traceListWrapper.value as HTMLDivElement, handleClientResize);
    });

    // Span List 相关
    const tableColumnOfSpan = [
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='span_id'
            theme='light'
            placement='right'
          >
            <span class='th-label'>Span ID</span>
          </Popover>
        ),
        width: 140,
        field: 'span_id',
        sort: {
          sortFn: () => false
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: string; data: any[] }) => (
          <div
            class='link-column'
            onClick={() => handleShowSpanDetail(data)}
          >
            <span
              class='link-text'
              title={cell}
            >
              {cell}
            </span>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='span_name'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('接口名称')}</span>
          </Popover>
        ),
        field: 'span_name',
        filter: {
          list: traceListFilter.span_name,
          filterFn: () => true as any
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: string; data: ISpanListItem }) => (
          <div>
            <span title={cell}>{cell}</span>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='start_time'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('开始时间')}</span>
          </Popover>
        ),
        field: 'start_time',
        sort: {
          sortFn: () => false
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: number; data: ISpanListItem }) => (
          <div>
            <span>{`${formatDate(cell)} ${formatTime(cell)}`}</span>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='end_time'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('结束时间')}</span>
          </Popover>
        ),
        field: 'end_time',
        sort: {
          sortFn: () => false
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: number; data: ISpanListItem }) => (
          <div>
            <span>{`${formatDate(cell)} ${formatTime(cell)}`}</span>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='elapsed_time'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('耗时')}</span>
          </Popover>
        ),
        field: 'elapsed_time',
        width: 120,
        sort: {
          sortFn: () => false
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: number; data: ISpanListItem }) => (
          <div>
            <span>{formatDuration(cell, ' ')}</span>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='status_code'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('状态')}</span>
          </Popover>
        ),
        field: 'status_code',
        width: 120,
        filter: {
          list: traceListFilter['status.code'],
          filterFn: () => true as any
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: number; data: ISpanListItem }) => (
          // TODO: 需要补上 圆点 样式
          <div style='display: flex; align-items: center'>
            <span class={`span-status-code-${data.status_code.type}`}></span>
            <span>{data.status_code.value}</span>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='kind'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('类型')}</span>
          </Popover>
        ),
        field: 'kind',
        width: 150,
        filter: {
          list: traceListFilter.kind,
          filterFn: () => true as any
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: number; data: ISpanListItem }) => (
          <div>
            <span>{SPAN_KIND_MAPS[data.kind]}</span>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='resource.service.name'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('所属服务')}</span>
          </Popover>
        ),
        field: 'resource.service.name',
        filter: {
          // eslint-disable-next-line @typescript-eslint/quotes
          list: traceListFilter['resource.service.name'],
          filterFn: () => true as any
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: string; data: ISpanListItem }) => (
          <div
            class='link-column'
            onClick={() => handleOpenService(data.resource['service.name'])}
          >
            <span title={data.resource['service.name']}>{data.resource['service.name']}</span>
            <i class='icon-monitor icon-fenxiang'></i>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='resource.bk.instance.id'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('实例 ID')}</span>
          </Popover>
        ),
        field: 'resource.bk.instance.id',
        filter: {
          // eslint-disable-next-line @typescript-eslint/quotes
          list: traceListFilter['resource.bk.instance.id'],
          filterFn: () => true as any
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: string; data: ISpanListItem }) => (
          <div>
            {/* // eslint-disable-next-line @typescript-eslint/quotes */}
            <span title={data.resource['bk.instance.id']}>{data.resource['bk.instance.id']}</span>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='resource.telemetry.sdk.name'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('SDK 名称')}</span>
          </Popover>
        ),
        field: 'resource.telemetry.sdk.name',
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: string; data: ISpanListItem }) => (
          <div>
            {/* // eslint-disable-next-line @typescript-eslint/quotes */}
            <span title={data.resource['telemetry.sdk.name']}>{data.resource['telemetry.sdk.name']}</span>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='resource.telemetry.sdk.version'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('SDK 版本')}</span>
          </Popover>
        ),
        field: 'resource.telemetry.sdk.version',
        filter: {
          // eslint-disable-next-line @typescript-eslint/quotes
          list: traceListFilter['resource.telemetry.sdk.version'],
          filterFn: () => true as any
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: string; data: ISpanListItem }) => (
          <div>
            {/* // eslint-disable-next-line @typescript-eslint/quotes */}
            <span title={data.resource['telemetry.sdk.version']}>{data.resource['telemetry.sdk.version']}</span>
          </div>
        )
      },
      {
        label: () => (
          <Popover
            popoverDelay={[500, 0]}
            content='trace_id'
            theme='light'
            placement='right'
          >
            <span class='th-label'>{window.i18n.t('所属Trace')}</span>
          </Popover>
        ),
        field: 'trace_id',
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: ({ cell, data }: { cell: string; data: any[] }) => (
          <div class='link-column'>
            <span
              class='link-text'
              title={cell}
              onClick={() => handleToTraceQuery(cell)}
            >
              {cell}
            </span>
            <i class='icon-monitor icon-fenxiang'></i>
          </div>
        )
      }
    ];

    const isSpanDetailLoading = ref(false);
    const isShowSpanDetail = ref(false);
    const spanDetails = reactive({});
    async function handleShowSpanDetail(span: any) {
      const params = {
        bk_biz_id: window.bk_biz_id,
        app_name: props.appName,
        span_id: span.span_id
      };
      isShowSpanDetail.value = true;
      isSpanDetailLoading.value = true;
      await spanDetail(params)
        .then(result => {
          // TODO：这里是东凑西凑出来的数据，代码并不严谨，后期需要调整。
          store.setSpanDetailData(result);
          // eslint-disable-next-line no-param-reassign
          result.trace_tree.traceID = result?.trace_tree?.spans?.[0]?.traceID;
          Object.assign(spanDetails, transformTraceTree(result.trace_tree)?.spans?.[0]);
        })
        .catch(() => {})
        .finally(() => {
          isSpanDetailLoading.value = false;
        });
    }

    function handleTraceColumnSort(option: any) {
      emit('columnSortChange', {
        type: option.type,
        column: option.column
      });
    }

    /** 跳转traceId精确查询 */
    function handleToTraceQuery(traceId: string) {
      // eslint-disable-next-line no-useless-escape
      const hash = `#/trace/home?app_name=${props.appName}&search_type=accurate&trace_id=${traceId}`;
      const url = location.href.replace(location.hash, hash);
      window.open(url, '_blank');
    }

    function handleTraceTableSettingsChange(settings: { checked: string[]; size: string; height: number }) {
      store.tableSettings.trace.checked = settings.checked;
    }

    function handleSpanTableSettingsChange(settings: { checked: string[]; size: string; height: number }) {
      store.tableSettings.span.checked = settings.checked;
    }

    return {
      ...toRefs(state),
      ...toRefs(props),
      tableColumns,
      traceListWrapper,
      height,
      chartContent,
      traceTableMain,
      traceTableElem,
      traceDetailElem,
      traceTableContainer,
      statusList,
      handleSpanFilter,
      handleCollapse,
      handleStatusChange,
      handleColseDetail,
      handleScrollBottom,
      handleSourceData,
      chartList,
      isFullscreen,
      localTableData,
      curTraceId,
      showTraceDetail,
      totalCount,
      isListLoading,
      renderKey,
      selectedListType,
      selectedSpanType,
      handleListTypeChange,
      handleSpanTypeChange,
      tableColumnOfSpan,
      tableDataOfSpan,
      isSpanDetailLoading,
      isShowSpanDetail,
      spanDetails,
      handleTraceColumnSort,
      handleDialogClose,
      selectedInterfaceStatisticsType,
      selectedInterfaceTypeInInterfaceStatistics,
      interfaceTypeListInInterfaceStatistics,
      selectedSourceTypeInInterfaceStatistics,
      sourceTypeListInInterfaceStatistics,
      handleInterfaceStatisticsChange,
      selectedServiceStatisticsType,
      selectedInterfaceTypeInServiceStatistics,
      interfaceTypeListInServiceStatistics,
      selectedSourceTypeInServiceStatistics,
      sourceTypeListInServiceStatistics,
      handleServiceStatisticsChange,
      traceListFilter,
      selectedTraceType,
      handleTraceTypeChange,
      handleTraceTableSettingsChange,
      handleSpanTableSettingsChange,
      store
    };
  },

  render() {
    const { appName } = this.$props;
    const tableEmptyContent = () => (
      <EmptyStatus type='search-empty'>
        <div class='search-empty-content'>
          <div class='tips'>{this.$t('您可以按照以下方式优化检索结果')}</div>
          <div class='description'>
            1. {this.$t('检查')}
            <span
              class='link'
              onClick={() => this.handleSourceData()}
            >
              {this.$t('数据源配置')}
            </span>
            {this.$t('情况')}
          </div>
          <div class='description'>2. {this.$t('检查右上角的时间范围')}</div>
          <div class='description'>3. {this.$t('是否启用了采样，采样不保证全量数据')}</div>
          <div class='description'>
            4. {this.$t('优化查询语句')}
            <div class='sub-description'>{`${this.$t('带字段全文检索更高效')}：log:abc`}</div>
            <div class='sub-description'>{`${this.$t('模糊检索使用通配符')}：log:abc* ${this.$t('或')} log:ab?c`}</div>
            <div class='sub-description'>{`${this.$t('双引号匹配完整字符串')}: log:"ERROR MSG"`}</div>
            <div class='sub-description'>{`${this.$t('数值字段范围匹配')}: count:[1 TO 5]`}</div>
            <div class='sub-description'>{`${this.$t('正则匹配')}：name:/joh?n(ath[oa]n/`}</div>
            <div class='sub-description'>{`${this.$t('组合检索注意大写')}：log: (error OR info)`}</div>
          </div>
          <div
            class='description link'
            style='margin-top: 8px'
          >
            {this.$t('查看更多语法规则')}
            <span class='icon-monitor icon-fenxiang'></span>
          </div>
        </div>
      </EmptyStatus>
    );
    const traceTableContent = (showDetail: boolean) => (
      <div
        class={`trace-content-table-wrap ${this.showTraceDetail ? 'is-show-detail' : ' '}`}
        key={this.renderKey}
        ref='traceTableContainer'
      >
        <Table
          ref='traceTableElem'
          style='height: 100%'
          height='100%'
          tabindex={-1}
          class='trace-table'
          // rowHeight={40}
          border={this.isFullscreen ? '' : ['outer']}
          columns={this.tableColumns}
          data={this.localTableData}
          rowStyle={(row: { traceID: string[] }) => {
            if (this.showTraceDetail && row.traceID?.[0] === this.curTraceId) return { background: '#EDF4FF' };
            return {};
          }}
          settings={this.store.tableSettings.trace}
          scroll-loading={this.tableLoading}
          onScrollBottom={this.handleScrollBottom}
          onColumnFilter={this.handleSpanFilter}
          onColumnSort={this.handleTraceColumnSort}
          onSettingChange={this.handleTraceTableSettingsChange}
          v-slots={{ empty: () => tableEmptyContent() }}
        />
        {showDetail && this.showTraceDetail && (
          <div class={`detail-box ${this.isFullscreen ? 'fullsreen-box' : ''}`}>
            <TraceDetail
              ref='traceDetailElem'
              isInTable
              appName={appName}
              traceID={this.curTraceId}
              onClose={this.handleColseDetail}
            />
          </div>
        )}
      </div>
    );
    const spanTableContent = () => (
      <div class='trace-content-table-wrap'>
        <Table
          ref='tableSpanElem'
          style='height: 100%'
          height='100%'
          tabindex={-1}
          class='table-span'
          rowHeight={40}
          border={['outer']}
          columns={this.tableColumnOfSpan}
          data={this.tableDataOfSpan}
          settings={this.store.tableSettings.span}
          scroll-loading={this.tableLoading}
          onScrollBottom={this.handleScrollBottom}
          onColumnFilter={this.handleSpanFilter}
          onColumnSort={this.handleTraceColumnSort}
          onSettingChange={this.handleSpanTableSettingsChange}
          // TODO：后期确认空数据的设计样式
          // v-slots={{ empty: () => tableEmptyContent() }}
        />
      </div>
    );
    const interfaceStatisticsTableContent = () => (
      <div class='trace-content-table-wrap'>
        <InterfaceStatistics
          filterList={this.traceListFilter}
          interfaceTypeList={this.selectedInterfaceTypeInInterfaceStatistics}
          sourceTypeList={this.selectedSourceTypeInInterfaceStatistics}
          scroll-loading={this.tableLoading}
          // @ts-ignore
          onScrollBottom={this.handleScrollBottom}
          onColumnFilter={this.handleSpanFilter}
          // onColumnSort={this.handleTraceColumnSort}
        ></InterfaceStatistics>
      </div>
    );

    const serviceStatisticsTableContent = () => (
      <div class='trace-content-table-wrap'>
        <ServiceStatistics
          filterList={this.traceListFilter}
          interfaceTypeList={this.selectedInterfaceTypeInServiceStatistics}
          sourceTypeList={this.selectedSourceTypeInServiceStatistics}
          scroll-loading={this.tableLoading}
          // @ts-ignore
          onScrollBottom={this.handleScrollBottom}
          onColumnFilter={this.handleSpanFilter}
          // onColumnSort={this.handleTraceColumnSort}
        ></ServiceStatistics>
      </div>
    );

    return (
      <div
        class='trace-list-wrapper'
        ref='traceListWrapper'
      >
        <div
          class='chart-content'
          ref='chartContent'
        >
          <div
            class={`collapse-title ${this.collapseActive ? 'collapse-active' : ''}`}
            onClick={this.handleCollapse}
          >
            <span class='icon-monitor icon-mc-triangle-down'></span>
            <span>{this.$t('总览')}</span>
          </div>
          {this.collapseActive && (
            <div class='chart-list'>
              {this.chartList.map(panel => (
                <TimeSeries
                  class='chart-list-item'
                  key={panel.id}
                  panel={panel}
                />
              ))}
            </div>
          )}
        </div>
        <div
          ref='traceTableMain'
          class={['trace-table-main', { 'is-fullscreen': this.isFullscreen }]}
          style={`height: ${this.height}px`}
        >
          <Loading
            loading={this.isFullscreen && this.isListLoading}
            class={`full-screen-loading ${this.isFullscreen ? 'is-active' : ''}`}
          >
            <div class='table-filter'>
              <Radio.Group
                v-model={this.selectedListType}
                onChange={this.handleListTypeChange}
              >
                <Radio.Button label='trace'>{this.$t('Trace 视角')}</Radio.Button>
                <Radio.Button label='span'>{this.$t('Span 视角')}</Radio.Button>
                <Radio.Button label='interfaceStatistics'>{this.$t('接口统计')}</Radio.Button>
                <Radio.Button label='serviceStatistics'>{this.$t('服务统计')}</Radio.Button>
              </Radio.Group>

              {/* 20230816 列表的每一个子项都添加 key ，解决切换列表时可能会渲染异常的问题，这里用静态 key ，因为触发 checkbox.group 时会重新执行动态 key ，避免再一次重新渲染。  */}
              {this.selectedListType === 'trace' && (
                <div
                  class='trace-filter'
                  key='trace-filter'
                >
                  <span style='margin-right: 6px;'>{this.$t('包含')}：</span>
                  <Checkbox.Group
                    v-model={this.selectedTraceType}
                    onChange={this.handleTraceTypeChange}
                  >
                    <Checkbox label={TraceFilter.Error}>{this.$t('错误')}</Checkbox>
                  </Checkbox.Group>
                </div>
              )}

              {this.selectedListType === 'span' && (
                <div
                  class='span-filter'
                  key='span-filter'
                >
                  {/* 第二期没有 第三方、错误  */}
                  <span style='margin-right: 6px;'>{this.$t('包含')}：</span>
                  <Checkbox.Group
                    v-model={this.selectedSpanType}
                    onChange={this.handleSpanTypeChange}
                  >
                    <Popover
                      content={this.$t('整个Trace的第一个Span')}
                      theme='light'
                      placement='top'
                    >
                      <Checkbox label={SpanFilter.RootSpan}>{this.$t('根Span')}</Checkbox>
                    </Popover>
                    <Popover
                      content={this.$t('每个Service的第一个Span')}
                      theme='light'
                      placement='top'
                    >
                      <Checkbox label={SpanFilter.EntrySpan}>{this.$t('入口Span')}</Checkbox>
                    </Popover>
                    {/* 20230816 后端未上线勿删 */}
                    {/* <Checkbox
                      label={SpanFilter.ThirdPart}
                      key={random(6)}
                    >
                      {this.$t('第三方')}
                    </Checkbox> */}
                    <Checkbox label={SpanFilter.Error}>{this.$t('错误')}</Checkbox>
                  </Checkbox.Group>
                </div>
              )}

              {this.selectedListType === 'interfaceStatistics' && (
                <div
                  class='interface-statistics-filter'
                  key='interface-statistics-filter'
                >
                  <span style='margin-right: 6px;'>{this.$t('包含')}：</span>
                  <Checkbox.Group
                    v-model={this.selectedInterfaceStatisticsType}
                    onChange={this.handleInterfaceStatisticsChange}
                  >
                    <Popover
                      content={this.$t('整个Trace的第一个Span')}
                      theme='light'
                      placement='top'
                    >
                      <Checkbox label={InterfaceStatisticsFilter.RootSpan}>{this.$t('根Span')}</Checkbox>
                    </Popover>
                    <Popover
                      content={this.$t('每个Service的第一个Span')}
                      theme='light'
                      placement='top'
                    >
                      <Checkbox label={InterfaceStatisticsFilter.RootServiceSpan}>{this.$t('服务入口Span')}</Checkbox>
                    </Popover>
                    <Checkbox label={InterfaceStatisticsFilter.StatusCode}>{this.$t('错误')}</Checkbox>
                  </Checkbox.Group>

                  {/* <span style='margin-left: 20px'>{this.$t('接口类型')}：</span>
                  <Select v-model={this.selectedInterfaceTypeInInterfaceStatistics}
                    size="small"
                    behavior="simplicity"
                    multiple
                    filterable
                    show-select-all
                    onChange={this.handleInterfaceStatisticsChange}>
                    { this.interfaceTypeListInInterfaceStatistics
                      .map(item => <Select.Option label={item.label} value={item.value}></Select.Option>) }
                  </Select>

                  <span style='margin-left: 20px'>{this.$t('来源类型')}：</span>
                  <Select v-model={this.selectedSourceTypeInInterfaceStatistics}
                    size="small"
                    behavior="simplicity"
                    multiple
                    filterable
                    show-select-all
                    onChange={this.handleInterfaceStatisticsChange}>
                    { this.sourceTypeListInInterfaceStatistics
                      .map(item => <Select.Option label={item.label} value={item.value}></Select.Option>) }
                  </Select> */}
                </div>
              )}

              {this.selectedListType === 'serviceStatistics' && (
                <div
                  class='span-service-statistics-filter'
                  key='span-service-statistics-filter'
                >
                  <span style='margin-right: 6px;'>{this.$t('包含')}：</span>
                  <Checkbox.Group
                    v-model={this.selectedServiceStatisticsType}
                    onChange={this.handleServiceStatisticsChange}
                  >
                    <Checkbox label={ServiceStatisticsFilter.Error}>{this.$t('错误')}</Checkbox>
                  </Checkbox.Group>

                  {/* 勿删 20230607 */}
                  {/* <span style='margin-left: 20px'>{this.$t('接口类型')}：</span>
                  <Select v-model={this.selectedInterfaceTypeInServiceStatistics}
                    size="small"
                    behavior="simplicity"
                    multiple
                    filterable
                    show-select-all
                    onBlur={this.handleServiceStatisticsChange}
                    onClear={this.handleServiceStatisticsChange}>
                    { this.interfaceTypeListInServiceStatistics
                      .map(item => <Select.Option label={item.label} value={item.value}></Select.Option>) }
                  </Select> */}

                  {/* <span style='margin-left: 20px'>{this.$t('来源类型')}：</span>
                  <Select v-model={this.selectedSourceTypeInServiceStatistics}
                    size="small"
                    behavior="simplicity"
                    multiple
                    filterable
                    show-select-all>
                    { this.sourceTypeListInServiceStatistics
                      .map(item => <Select.Option label={item.label} value={item.value}></Select.Option>) }
                  </Select> */}
                </div>
              )}
            </div>
            {this.selectedListType === 'trace' && traceTableContent(false)}
            {this.selectedListType === 'span' && spanTableContent()}
            {this.selectedListType === 'interfaceStatistics' && interfaceStatisticsTableContent()}
            {this.selectedListType === 'serviceStatistics' && serviceStatisticsTableContent()}
          </Loading>
        </div>

        <SpanDetails
          show={this.isShowSpanDetail}
          isPageLoading={this.isSpanDetailLoading}
          isFullscreen={this.isFullscreen}
          spanDetails={this.spanDetails}
          onShow={v => (this.isShowSpanDetail = v)}
        ></SpanDetails>

        <Dialog
          class='trace-info-fullscreen-dialog'
          is-show={this.isFullscreen}
          fullscreen
          multi-instance
          onClosed={this.handleDialogClose}
        >
          {traceTableContent(true)}
        </Dialog>

        <div class={`monitor-trace-alert ${this.isFullscreen ? 'fadeout' : ''}`}>
          <i18n-t
            class='alert-text'
            keypath='按{0}即可关闭全屏弹窗'
          >
            <span class='keyboard-button'>esc</span>
          </i18n-t>
        </div>
      </div>
    );
  }
});
