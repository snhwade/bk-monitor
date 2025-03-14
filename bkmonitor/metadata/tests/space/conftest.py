# -*- coding: utf-8 -*-
"""
Tencent is pleased to support the open source community by making 蓝鲸智云 - 监控平台 (BlueKing - Monitor) available.
Copyright (C) 2017-2021 THL A29 Limited, a Tencent company. All rights reserved.
Licensed under the MIT License (the "License"); you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://opensource.org/licenses/MIT
Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.
"""
import pytest

from metadata import models

DEFAULT_NAME = "test_query"
DEFAULT_DATA_ID = 11000
DEFAULT_BIZ_ID = 1
DEFAULT_MQ_CLUSTER_ID = 10000
DEFAULT_MQ_CONFIG_ID = 10001
DEFAULT_SPACE_TYPE = "bkcc"
DEFAULT_SPACE_ID = "test"
DEFAULT_OTHER_SPACE_ID = "other"

pytestmark = pytest.mark.django_db


@pytest.fixture
def create_and_delete_record(mocker):
    # 创建三条记录
    # - 普通的 data id
    # - 空间级的 data id
    # - 全空间的 data id
    params = [
        models.DataSource(
            bk_data_id=DEFAULT_DATA_ID,
            data_name=DEFAULT_NAME,
            mq_cluster_id=DEFAULT_MQ_CLUSTER_ID,
            mq_config_id=DEFAULT_MQ_CONFIG_ID,
            etl_config="test",
            is_custom_source=False,
            is_platform_data_id=False,
            space_type_id=DEFAULT_SPACE_TYPE,
        ),
        models.DataSource(
            bk_data_id=DEFAULT_DATA_ID + 1,
            data_name=f"{DEFAULT_NAME}1",
            mq_cluster_id=DEFAULT_MQ_CLUSTER_ID,
            mq_config_id=DEFAULT_MQ_CONFIG_ID,
            etl_config="test",
            is_custom_source=False,
            is_platform_data_id=True,
            space_type_id=DEFAULT_SPACE_TYPE,
        ),
        models.DataSource(
            bk_data_id=DEFAULT_DATA_ID + 2,
            data_name=f"{DEFAULT_NAME}2",
            mq_cluster_id=DEFAULT_MQ_CLUSTER_ID,
            mq_config_id=DEFAULT_MQ_CONFIG_ID,
            etl_config="test",
            is_custom_source=False,
            is_platform_data_id=True,
            space_type_id="all",
        ),
    ]
    models.DataSource.objects.bulk_create(params)
    models.SpaceDataSource.objects.create(
        space_type_id=DEFAULT_SPACE_TYPE, space_id=DEFAULT_SPACE_ID, bk_data_id=DEFAULT_DATA_ID
    )
    models.SpaceDataSource.objects.create(
        space_type_id=DEFAULT_SPACE_TYPE, space_id=DEFAULT_SPACE_ID, bk_data_id=DEFAULT_DATA_ID + 1
    )
    yield
    mocker.patch("bkmonitor.utils.consul.BKConsul", side_effect=consul_client)
    models.DataSource.objects.filter(data_name__startswith=DEFAULT_NAME).delete()
    models.SpaceDataSource.objects.all().delete()


def consul_client(*args, **kwargs):
    return CustomConsul()


class CustomConsul:
    def __init__(self):
        self.kv = KVDelete()


class KVDelete:
    def delete(self, *args, **kwargs):
        return True
