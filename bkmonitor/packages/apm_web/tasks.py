# -*- coding: utf-8 -*-
"""
Tencent is pleased to support the open source community by making 蓝鲸智云 - 监控平台 (BlueKing - Monitor) available.
Copyright (C) 2017-2022 THL A29 Limited, a Tencent company. All rights reserved.
Licensed under the MIT License (the "License"); you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://opensource.org/licenses/MIT
Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.
"""
import time

from apm_web.handlers.service_handler import ServiceHandler
from apm_web.models import Application
from apm_web.serializers import ApplicationCacheSerializer
from celery.task import task
from common.log import logger
from django.conf import settings
from django.utils.translation import gettext as _

from bkmonitor.utils.common_utils import get_local_ip
from bkmonitor.utils.custom_report_tools import custom_report_tool
from core.drf_resource import api


def build_event_body(app: Application, bk_biz_id: int):
    event_body_map = {"event_name": _("监控平台新APM应用创建")}
    response_biz_data = api.cmdb.get_business(bk_biz_ids=[bk_biz_id])
    if response_biz_data:
        biz_data = response_biz_data[0]
        bk_biz_name = biz_data.bk_biz_name
    else:
        bk_biz_name = ""

    event_body_map["target"] = get_local_ip()
    event_body_map["timestamp"] = int(round(time.time() * 1000))
    event_body_map["dimension"] = {"bk_biz_id": bk_biz_id, "bk_biz_name": bk_biz_name}
    content = _("有新APM应用创建，请关注！应用名称：{}, 业务ID：{}, 业务名称：{}, 创建者：{}，创建时间：{}").format(
        app.app_name, bk_biz_id, bk_biz_name, app.create_user, app.create_time
    )
    event_body_map["event"] = {"content": content}
    return [event_body_map]


@task(ignore_result=True)
def update_application_config(application_id):
    Application.objects.get(application_id=application_id).refresh_config()


@task(ignore_result=True)
def refresh_application_data_status():
    for application in Application.objects.filter(is_enabled=True):
        _refresh_application_data_status.delay(application.application_id)


@task(ignore_result=True)
def _refresh_application_data_status(application_id):
    Application.objects.get(application_id=application_id).set_data_status()


@task(ignore_result=True)
def refresh_application():
    logger.info("[REFRESH_APPLICATION] task start")

    # 刷新数据状态
    for application in Application.objects.filter(is_enabled=True):
        application.set_data_status()

    logger.info("[REFRESH_APPLICATION] task finished")


@task(ignore_result=True)
def report_apm_application_event(bk_biz_id, application_id):
    logger.info(f"[report_apm_application_event] task start, bk_biz_id({bk_biz_id}), application_id({application_id})")

    application = Application.objects.get(application_id=application_id)
    data = build_event_body(application, bk_biz_id)
    config_info = settings.APM_CUSTOM_EVENT_REPORT_CONFIG
    data_id = config_info.get("data_id", "")
    token = config_info.get("token", "")
    if config_info and token:
        custom_report_tool(data_id).send_data_by_http(data, token)
    else:
        logger.info("[report_apm_application_event] config is empty, do nothing")

    logger.info(
        f"[report_apm_application_event] task finished, bk_biz_id({bk_biz_id}), application_id({application_id})"
    )


@task(ignore_result=True)
def refresh_apm_application_metric():
    logger.info("[refresh_apm_application_metric] task start")

    # 刷新 APM 应用列表页, 应用指标数据
    queryset = Application.objects.filter(is_enabled=True)

    applications = ApplicationCacheSerializer(queryset, many=True).data

    ServiceHandler.refresh_application_cache_data(applications)

    logger.info("[refresh_apm_application_metric] task finished")
