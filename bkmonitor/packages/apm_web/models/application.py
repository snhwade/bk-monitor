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
from apm_web.constants import (
    DEFAULT_NO_DATA_PERIOD,
    ApdexConfigEnum,
    CustomServiceMatchType,
    CustomServiceType,
    DataStatus,
    DefaultApdex,
    DefaultDimensionConfig,
    DefaultInstanceNameConfig,
    DefaultSamplerConfig,
)
from apm_web.metric_handler import RequestCountInstance
from common.log import logger
from django.db import models
from django.db.transaction import atomic
from django.utils.functional import cached_property
from django.utils.translation import ugettext_lazy as _
from opentelemetry.semconv.trace import SpanAttributes

from bkmonitor.iam import Permission, ResourceEnum
from bkmonitor.middlewares.source import get_source_app_code
from bkmonitor.utils.db import JsonField
from bkmonitor.utils.model_manager import AbstractRecordModel
from bkmonitor.utils.request import get_request
from bkmonitor.utils.time_tools import get_datetime_range
from constants.apm import OtlpKey, SpanKindKey
from core.drf_resource import api, resource


class Application(AbstractRecordModel):
    DEPLOYMENT_KEY = "deployment"
    LANGUAGE_KEY = "language"
    PLUGING_KEY = "plugin"

    APPLICATION_DATASOURCE_CONFIG_KEY = "application_datasource_config"

    class DatasourceConfig:
        ES_RETENTION = "es_retention"
        ES_STORAGE_CLUSTER = "es_storage_cluster"
        ES_NUMBER_OF_REPLICAS = "es_number_of_replicas"

    APDEX_CONFIG_KEY = "application_apdex_config"
    SAMPLER_CONFIG_KEY = "application_sampler_config"
    INSTANCE_NAME_CONFIG_KEY = "application_instance_name_config"
    DIMENSION_CONFIG_KEY = "application_dimension_config"

    class ApdexConfig:
        """Apdex配置项"""

        APDEX_DEFAULT = ApdexConfigEnum.DEFAULT
        APDEX_HTTP = ApdexConfigEnum.HTTP
        APDEX_DB = ApdexConfigEnum.DB
        APDEX_MESSAGING = ApdexConfigEnum.MESSAGING
        APDEX_BACKEND = ApdexConfigEnum.BACKEND
        APDEX_RPC = ApdexConfigEnum.RPC

    class SamplerConfig:
        """采样配置项"""

        SAMPLER_TYPE = "sampler_type"
        SAMPLER_PERCENTAGE = "sampler_percentage"

    class InstanceNameConfig:
        """实例名配置项"""

        INSTANCE_NAME_COMPOSITION = "instance_name_composition"

    class DimensionConfig:
        """维度配置项"""

        DIMENSIONS = "dimensions"

    # 不同Apdex配置的规则对应关系
    APDEX_RULE_MAPPING = {
        ApdexConfig.APDEX_HTTP: [
            {"span_kind": SpanKindKey.CLIENT, "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.HTTP_METHOD)},
            {"span_kind": SpanKindKey.SERVER, "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.HTTP_METHOD)},
        ],
        ApdexConfig.APDEX_DEFAULT: [
            {"span_kind": SpanKindKey.UNSPECIFIED, "predicate_key": ""},
            {"span_kind": SpanKindKey.INTERNAL, "predicate_key": ""},
            {"span_kind": SpanKindKey.SERVER, "predicate_key": ""},
            {"span_kind": SpanKindKey.CLIENT, "predicate_key": ""},
            {"span_kind": SpanKindKey.PRODUCER, "predicate_key": ""},
            {"span_kind": SpanKindKey.CONSUMER, "predicate_key": ""},
        ],
        ApdexConfig.APDEX_DB: [
            {"span_kind": SpanKindKey.CLIENT, "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.DB_SYSTEM)}
        ],
        ApdexConfig.APDEX_RPC: [
            {"span_kind": SpanKindKey.CLIENT, "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.RPC_SYSTEM)},
            {"span_kind": SpanKindKey.SERVER, "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.RPC_SYSTEM)},
            {"span_kind": SpanKindKey.PRODUCER, "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.RPC_SYSTEM)},
            {"span_kind": SpanKindKey.CONSUMER, "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.RPC_SYSTEM)},
        ],
        ApdexConfig.APDEX_MESSAGING: [
            {
                "span_kind": SpanKindKey.PRODUCER,
                "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.MESSAGING_SYSTEM),
            },
            {
                "span_kind": SpanKindKey.CONSUMER,
                "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.MESSAGING_SYSTEM),
            },
            {
                "span_kind": SpanKindKey.PRODUCER,
                "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.MESSAGING_DESTINATION),
            },
            {
                "span_kind": SpanKindKey.CONSUMER,
                "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.MESSAGING_DESTINATION),
            },
        ],
        ApdexConfig.APDEX_BACKEND: [
            {
                "span_kind": SpanKindKey.PRODUCER,
                "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.MESSAGING_SYSTEM),
            },
            {
                "span_kind": SpanKindKey.CONSUMER,
                "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.MESSAGING_SYSTEM),
            },
            {
                "span_kind": SpanKindKey.PRODUCER,
                "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.MESSAGING_DESTINATION),
            },
            {
                "span_kind": SpanKindKey.CONSUMER,
                "predicate_key": OtlpKey.get_attributes_key(SpanAttributes.MESSAGING_DESTINATION),
            },
        ],
    }

    NO_DATA_CONFIG_KEY = "no_data_config"

    class NoDataConfig:
        no_data_period = "no_data_period"

    application_id = models.IntegerField("应用Id", primary_key=True)
    bk_biz_id = models.IntegerField("业务id")
    app_name = models.CharField("应用名称", max_length=50)
    app_alias = models.CharField("应用别名", max_length=128)
    description = models.CharField("应用描述", max_length=255)
    metric_result_table_id = models.CharField("指标结果表", max_length=255, default="")
    trace_result_table_id = models.CharField("Trace结果表", max_length=255, default="")
    time_series_group_id = models.IntegerField("时序分组ID", default=0)
    data_status = models.CharField("数据状态", default=DataStatus.NO_DATA, max_length=50)
    source = models.CharField("来源系统", default=get_source_app_code, max_length=32)

    class Meta:
        ordering = ["-update_time", "-application_id"]

    def __str__(self):
        return self.__repr__()

    def __repr__(self):
        return f"<Application {self.application_id} {self.app_name}>"

    @cached_property
    def storage_plan(self):
        es_storage_config = self.get_config_by_key(self.APPLICATION_DATASOURCE_CONFIG_KEY).config_value
        return _("{}天").format(es_storage_config[self.DatasourceConfig.ES_RETENTION])

    @cached_property
    def es_storage_cluster(self):
        es_storage_config = self.get_config_by_key(self.APPLICATION_DATASOURCE_CONFIG_KEY).config_value
        return es_storage_config[self.DatasourceConfig.ES_STORAGE_CLUSTER]

    @cached_property
    def es_retention(self):
        es_storage_config = self.get_config_by_key(self.APPLICATION_DATASOURCE_CONFIG_KEY).config_value
        return es_storage_config[self.DatasourceConfig.ES_RETENTION]

    @cached_property
    def plugin_id(self):
        return (
            ApplicationRelationInfo.objects.filter(application_id=self.application_id, relation_key=self.PLUGING_KEY)
            .first()
            .relation_value
        )

    @cached_property
    def metric_info(self):
        metric_info = api.metadata.get_time_series_group({"time_series_group_id": self.time_series_group_id})
        result = []
        for metric_item in metric_info:
            metric_list = metric_item.get("metric_info_list", [])
            database_name, __ = metric_item["table_id"].split(".")
            for metric in metric_list:
                __, table_name = metric["table_id"].split(".")
                metric["table_id"] = f"{database_name}.{table_name}"
                metric["tags"] = []
                metric["data_source_label"] = _("自定义数据源")
                metric["result_table_label"] = "application_check"
                metric["result_table_label_name"] = _("业务应用")
                result.append(metric)
        return result

    @cached_property
    def deployment_ids(self):
        return list(
            ApplicationRelationInfo.objects.filter(
                application_id=self.application_id, relation_key=self.DEPLOYMENT_KEY
            ).values_list("relation_value", flat=True)
        )

    @cached_property
    def apdex_config(self):
        # 兼容旧版无此配置
        config = self.get_config_by_key(self.APDEX_CONFIG_KEY)
        if not config:
            return {}
        return config.config_value

    @cached_property
    def sampler_config(self):
        config = self.get_config_by_key(self.SAMPLER_CONFIG_KEY)
        if not config:
            return {}
        return config.config_value

    @cached_property
    def instance_config(self):
        config = self.get_config_by_key(self.INSTANCE_NAME_CONFIG_KEY)
        if not config:
            return {}
        return config.config_value

    @cached_property
    def dimension_config(self):
        config = self.get_config_by_key(self.DIMENSION_CONFIG_KEY)
        if not config:
            return {}
        return config.config_value

    @cached_property
    def no_data_period(self):
        no_data_config = self.get_config_by_key(self.NO_DATA_CONFIG_KEY)
        if no_data_config:
            return no_data_config.config_value[self.NoDataConfig.no_data_period]
        return DEFAULT_NO_DATA_PERIOD

    @cached_property
    def doc_count(self):
        """应用过期时间内的文档数量"""
        start_time, end_time = get_datetime_range("day", self.es_retention)
        start_time, end_time = int(start_time.timestamp()), int(end_time.timestamp())
        return RequestCountInstance(self, start_time, end_time).query_instance()

    def set_data_status(self):
        start_time, end_time = get_datetime_range("minute", self.no_data_period)
        start_time, end_time = int(start_time.timestamp()), int(end_time.timestamp())
        count = RequestCountInstance(self, start_time, end_time).query_instance()
        if count:
            logger.info(
                f"[Application] set_data_status ->  "
                f"bk_biz_id: {self.bk_biz_id} app: {self.app_name} have data in {self.no_data_period} period"
            )

            self.data_status = DataStatus.NORMAL
            self.save()
            return

        self.data_status = DataStatus.NO_DATA
        self.save()

    @property
    def language_ids(self):
        return list(
            ApplicationRelationInfo.objects.filter(
                application_id=self.application_id, relation_key=self.LANGUAGE_KEY
            ).values_list("relation_value", flat=True)
        )

    def get_all_config(self):
        return ApmMetaConfig.get_all_application_config_value(self.application_id)

    def get_config_by_key(self, key: str):
        return ApmMetaConfig.get_application_config_value(self.application_id, key)

    @classmethod
    def get_metric_table_id(cls, bk_biz_id, app_name):
        instance = cls.objects.filter(bk_biz_id=bk_biz_id, app_name=app_name).first()
        if not instance:
            return None
        return instance.metric_result_table_id

    @classmethod
    def get_application_id_by_app_name(cls, app_name: str):
        request = get_request()
        try:
            return cls.objects.get(app_name=app_name, bk_biz_id=request.biz_id).application_id
        except cls.DoesNotExist:
            raise ValueError("application({}) not found".format(app_name))

    @classmethod
    @atomic
    def create_application(
        cls, bk_biz_id, app_name, app_alias, description, plugin_id, deployment_ids, language_ids, datasource_option
    ):
        application_info = api.apm_api.create_application(
            {
                "bk_biz_id": bk_biz_id,
                "app_name": app_name,
                "app_alias": app_alias,
                "description": description,
                "es_storage_config": datasource_option,
            }
        )

        application = cls.objects.create(
            application_id=application_info["application_id"],
            bk_biz_id=bk_biz_id,
            app_name=app_name,
            app_alias=app_alias,
            description=description,
        )

        application.add_relation(cls.PLUGING_KEY, plugin_id)
        for deployment_id in deployment_ids:
            application.add_relation(cls.DEPLOYMENT_KEY, deployment_id)
        for language_id in language_ids:
            application.add_relation(cls.LANGUAGE_KEY, language_id)

        application.set_init_datasource(application_info["datasource_info"], datasource_option)
        application.set_init_apdex_config()
        application.set_init_sampler_config()
        application.set_init_instance_name_config()
        # todo 暂时不做维度配置
        # obj.set_init_dimensions_config()
        application.authorization()

        from apm_web.tasks import update_application_config

        update_application_config.delay(application.application_id)
        return application

    def set_init_datasource(self, datasource_info, datasource_option):
        self.trace_result_table_id = datasource_info["trace_config"]["result_table_id"]
        self.metric_result_table_id = datasource_info["metric_config"]["result_table_id"]
        self.time_series_group_id = datasource_info["metric_config"]["time_series_group_id"]
        self.save()
        ApmMetaConfig.application_config_setup(
            self.application_id, self.APPLICATION_DATASOURCE_CONFIG_KEY, datasource_option
        )

    def set_init_dimensions_config(self):
        dimensions_value = {self.DimensionConfig.DIMENSIONS: DefaultDimensionConfig.DEFAULT_DIMENSIONS}
        ApmMetaConfig.application_config_setup(self.application_id, self.DIMENSION_CONFIG_KEY, dimensions_value)

    def set_init_instance_name_config(self):
        default_instance_name = DefaultInstanceNameConfig.DEFAULT_INSTANCE_NAME_COMPOSITION

        instance_value = {self.InstanceNameConfig.INSTANCE_NAME_COMPOSITION: default_instance_name}
        ApmMetaConfig.application_config_setup(self.application_id, self.INSTANCE_NAME_CONFIG_KEY, instance_value)

    def set_init_sampler_config(self):
        sampler_value = {
            self.SamplerConfig.SAMPLER_TYPE: DefaultSamplerConfig.TYPE,
            self.SamplerConfig.SAMPLER_PERCENTAGE: DefaultSamplerConfig.PERCENTAGE,
        }
        ApmMetaConfig.application_config_setup(self.application_id, self.SAMPLER_CONFIG_KEY, sampler_value)

    def authorization(self):
        try:
            permission = Permission()
            permission.grant_creator_action(
                ResourceEnum.APM_APPLICATION.create_simple_instance(self.application_id, {"bk_biz_id": self.bk_biz_id}),
                creator=self.update_user,
            )
            try:
                maintainers = resource.cc.get_app_by_id(self.bk_biz_id).maintainers
            except Exception as e:
                logger.error("get maintainers failed with error: %s", e)
                maintainers = []
            need_create_users = set(maintainers) | {self.update_user}

            for user in list(need_create_users):
                permission.grant_creator_action(
                    ResourceEnum.APM_APPLICATION.create_simple_instance(
                        self.application_id, {"bk_biz_id": self.bk_biz_id}
                    ),
                    creator=user,
                )
        except Exception as e:  # pylint: disable=broad-except
            logger.warning("application->({}) grant creator action failed, reason: {}".format(self.application_id, e))

    @classmethod
    def setup_datasource(cls, application_id, datasource_option: dict):
        application = cls.objects.filter(application_id=application_id).first()
        if not application:
            raise ValueError(_("应用不存在"))
        datasource_info = api.apm_api.apply_datasource(
            {"application_id": application.application_id, **datasource_option}
        )
        application.trace_result_table_id = datasource_info["trace_config"]["result_table_id"]
        application.metric_result_table_id = datasource_info["metric_config"]["result_table_id"]
        application.time_series_group_id = datasource_info["metric_config"]["time_series_group_id"]
        application.save()
        ApmMetaConfig.application_config_setup(application_id, cls.APPLICATION_DATASOURCE_CONFIG_KEY, datasource_option)

    def set_init_apdex_config(self):
        apdex_value = {
            self.ApdexConfig.APDEX_DEFAULT: DefaultApdex.DEFAULT,
            self.ApdexConfig.APDEX_HTTP: DefaultApdex.HTTP,
            self.ApdexConfig.APDEX_DB: DefaultApdex.DB,
            self.ApdexConfig.APDEX_RPC: DefaultApdex.RPC,
            self.ApdexConfig.APDEX_BACKEND: DefaultApdex.BACKEND,
            self.ApdexConfig.APDEX_MESSAGING: DefaultApdex.MESSAGE,
        }
        ApmMetaConfig.application_config_setup(self.application_id, self.APDEX_CONFIG_KEY, apdex_value)

    def setup_config(self, config, new_config, config_key, override=False):
        if override:
            config.update(new_config)
        else:
            config = new_config
        ApmMetaConfig.application_config_setup(self.application_id, config_key, config)

    def setup_apdex_config(self, key, value):
        apdex_value = self.apdex_config
        apdex_value[key] = value
        ApmMetaConfig.application_config_setup(self.application_id, self.APDEX_CONFIG_KEY, apdex_value)

    def setup_nodata_config(self, key, value):
        no_data_config = self.get_config_by_key(self.NO_DATA_CONFIG_KEY)
        if no_data_config:
            no_data_value = no_data_config.config_value
            no_data_value[key] = value
            ApmMetaConfig.application_config_setup(self.application_id, self.NO_DATA_CONFIG_KEY, no_data_value)
            return
        no_data_value = {key: value}
        ApmMetaConfig.application_config_setup(self.application_id, self.NO_DATA_CONFIG_KEY, no_data_value)

    def add_relation(self, relation_key: str, relation_value: str):
        ApplicationRelationInfo.add_relation(self.application_id, relation_key, relation_value)

    def refresh_config(self):

        config = self.get_transfer_config()

        api.apm_api.release_app_config({"bk_biz_id": self.bk_biz_id, "app_name": self.app_name, **config})

    def get_transfer_config(self):
        """获取传递给API侧的数据"""

        application_config = self.get_application_transfer_config()
        service_config = self.get_service_transfer_config()

        return {"service_configs": service_config, **application_config}

    def get_application_transfer_config(self):
        res = {}
        apdex_config = self.apdex_config

        # 组装apdex配置
        res["apdex_config"] = []
        for key, value in self.APDEX_RULE_MAPPING.items():
            for item in value:
                res["apdex_config"].append({"apdex_t": apdex_config[key], **item})

        # 组装采样配置
        res["sampler_config"] = {
            "sampling_percentage": self.sampler_config["sampler_percentage"],
            "sampler_type": self.sampler_config["sampler_type"],
        }

        # 组装实例配置
        res["instance_name_config"] = self.instance_config.get("instance_name_composition", [])

        # 组装维度配置
        res["dimension_config"] = self.dimension_config.get("dimensions")

        # 组装自定义服务配置
        query = ApplicationCustomService.objects.filter(bk_biz_id=self.bk_biz_id, app_name=self.app_name)
        from apm_web.serializers import CustomServiceSerializer

        res["custom_service_config"] = CustomServiceSerializer(instance=query, many=True).data

        return res

    def get_service_transfer_config(self):
        res = []

        # 1. 获取服务Apdex配置
        from apm_web.models import ApdexServiceRelation

        apdexs = ApdexServiceRelation.objects.filter(bk_biz_id=self.bk_biz_id, app_name=self.app_name)
        for apdex in apdexs:
            # 服务需要额外携带一个UNSPECIFIED类型的配置
            apdex_config = [{"span_kind": SpanKindKey.UNSPECIFIED, "predicate_key": "", "apdex_t": apdex.apdex_value}]
            apdex_kind_config = self.APDEX_RULE_MAPPING.get(apdex.apdex_key)

            for item in apdex_kind_config:
                apdex_config.append({"apdex_t": apdex.apdex_value, **item})
            res.append({"service_name": apdex.service_name, "apdex_config": apdex_config})

        return res


class ApplicationRelationInfo(models.Model):
    application_id = models.IntegerField("应用Id")
    relation_key = models.CharField("关联Key", max_length=255)
    relation_value = models.CharField("关联值", max_length=255)

    @classmethod
    def add_relation(cls, application_id: int, relation_key: str, relation_value: str):
        cls.objects.create(application_id=application_id, relation_key=relation_key, relation_value=relation_value)


class ApmMetaConfig(models.Model):
    BK_BIZ_LEVEL = "bk_biz_level"
    APPLICATION_LEVEL = "application_level"
    SERVICE_LEVEL = "service_level"

    config_level = models.CharField("配置级别", max_length=128)
    level_key = models.CharField("配置目标key", max_length=30)
    config_key = models.CharField("config key", max_length=255)
    config_value = JsonField("配置信息")

    class Meta:
        unique_together = [["config_level", "level_key", "config_key"]]

    @classmethod
    def get_all_application_config_value(cls, application_id):
        return cls.objects.filter(config_level=cls.APPLICATION_LEVEL, level_key=application_id)

    @classmethod
    def get_application_config_value(cls, application_id, config_key: str):
        return cls.objects.filter(
            config_key=config_key, config_level=cls.APPLICATION_LEVEL, level_key=application_id
        ).first()

    @classmethod
    def application_config_setup(cls, application_id, config_key, config_value):
        return cls._setup(cls.APPLICATION_LEVEL, application_id, config_key, config_value)

    @classmethod
    def bk_biz_config_setup(cls, bk_biz_id, config_key, config_value):
        return cls._setup(cls.BK_BIZ_LEVEL, bk_biz_id, config_key, config_value)

    @classmethod
    def service_config_setup(cls, service_id, config_key, config_value):
        return cls._setup(cls.SERVICE_LEVEL, service_id, config_key, config_value)

    @classmethod
    def _setup(cls, config_level, level_key, config_key, config_value):
        qs = cls.objects.filter(config_level=config_level, level_key=level_key, config_key=config_key)
        if qs.exists():
            qs.update(config_value=config_value)
            return

        cls.objects.create(
            config_level=config_level, level_key=level_key, config_key=config_key, config_value=config_value
        )


class ApplicationCustomService(AbstractRecordModel):
    bk_biz_id = models.IntegerField(verbose_name="业务id")
    app_name = models.CharField(verbose_name="应用名称", max_length=50)
    name = models.CharField(max_length=128, verbose_name="名称", null=True)
    type = models.CharField(max_length=32, choices=CustomServiceType.choices(), verbose_name="服务类型")
    match_type = models.CharField(max_length=32, choices=CustomServiceMatchType.choices(), verbose_name="匹配类型")
    rule = JsonField(verbose_name="匹配规则")
