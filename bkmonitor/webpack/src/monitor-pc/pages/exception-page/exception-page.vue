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
  <div class="exception-page">
    <bk-exception
      class="exception-page-img"
      :type="type"
    >
      <template v-if="type + '' === '403'">
        <div class="exception-title">{{ $t('您没有该资源的权限，请先申请或联系管理员!') }}<bk-button
          class="exception-btn"
          theme="primary"
          @click="handleGotoAppy"
        >{{ $t('去申请') }}</bk-button></div>
        <table class="permission-table table-header">
          <thead>
            <tr>
              <!-- <th width="20%">{{$t('系统')}}</th> -->
              <th width="30%">
                {{ $t('需要申请的权限') }}
              </th>
              <th width="50%">
                {{ $t('关联的资源实例') }}
              </th>
            </tr>
          </thead>
        </table>
        <div class="table-content">
          <table class="permission-table">
            <tbody>
              <template v-if="applyActions && applyActions.length > 0">
                <tr
                  v-for="(action, index) in applyActions"
                  :key="index"
                >
                  <!-- <td width="20%">{{authorityDetail.systemName}}</td> -->
                  <td width="30%">
                    {{ action.name }}
                  </td>
                  <td width="50%">
                    <p
                      class="resource-type-item"
                      v-for="(reItem, reIndex) in getResource(action.related_resource_types)"
                      :key="reIndex"
                    >
                      {{ reItem }}
                    </p>
                  </td>
                </tr>
              </template>
              <tr v-else>
                <td
                  class="no-data"
                  colspan="3"
                >{{ $t('无数据') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </bk-exception>
  </div>
</template>
<script lang="ts">
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

import { getAuthorityDetail } from '../../../monitor-api/modules/iam';
import { showAccessRequest } from '../../components/access-request-dialog';
Component.registerHooks(['beforeRouteEnter']);
@Component({
  name: 'error-exception'
})
export default class ExceptionPage extends Vue {
  @Prop({ default: '404' }) type: string | number;
  @Prop({ default: '' }) queryUid: string;
  applyUrl = '';
  applyActions = [];
  // beforeRouteEnter(to, from, next) {
  //   next(async (vm: ExceptionPage) => {
  //     const { actionId } = to.query
  //     if (actionId) {
  //       const data =  await getAuthorityDetail(
  //         { action_ids: Array.isArray(actionId) ? actionId : [actionId] }
  //         , { needMessage: false }
  //       ).catch(() => false)
  //       if (data) {
  //         vm.applyUrl = data.apply_url
  //       }
  //     }
  //   })
  // }
  @Watch('queryUid', { immediate: true })
  async onQeueryUidChange() {
    this.applyActions = [];
    const { actionId } = this.$route.query;
    if (actionId) {
      const data = await getAuthorityDetail(
        {
          action_ids: Array.isArray(actionId) ? actionId : [actionId],
          space_uid: window.space_uid || undefined,
          bk_biz_id: !window.space_uid ? window.bk_biz_id : undefined
        },
        { needMessage: false }
      ).catch(() => false);
      if (data) {
        this.applyActions = data.authority_list?.actions;
        this.applyUrl = data.apply_url;
      }
    }
  }

  handleGotoAppy() {
    showAccessRequest(this.applyUrl);
    // 20230703 暂时不要
    // if (!this.applyUrl) return;
    // try {
    //   if (self === top) {
    //     window.open(this.applyUrl, '__blank');
    //   } else {
    //     top.BLUEKING.api.open_app_by_other('bk_iam', this.applyUrl);
    //   }
    // } catch (_) {
    //   window.open(this.applyUrl, '__blank');
    // }
  }
  getResource(resoures) {
    if (resoures.length === 0) {
      return ['--'];
    }

    const data = [];
    resoures.forEach((resource) => {
      if (resource.instances.length > 0) {
        const instances = resource.instances
          .map(instanceItem => instanceItem.map(item => `[${item.id}]${item.name}`).join('，'))
          .join('，');
        const resourceItemData = `${resource.type_name}：${instances}`;
        data.push(resourceItemData);
      }
    });
    return data;
  }
}
</script>
<style lang="scss" scoped>
@import '../../theme/mixin.scss';

.exception-page {
  height: 100%;
  display: flex;
  position: relative;
  justify-content: center;

  @include permission-fix;

  .exception-title {
    margin-bottom: 15px;
    display: flex;
    align-items: center;
    font-size: 14px;
    justify-content: center;
  }

  &-img {
    position: absolute;
    top: 40%;
    transform: translateY(-50%);
    max-width: 800px;

    .exception-btn {
      margin-left: 10px;
    }
  }
}
</style>
