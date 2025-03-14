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
# Generated by Django 1.11.23 on 2022-01-20 10:02
from __future__ import unicode_literals

from django.db import migrations, models

import bkmonitor.utils.db.fields
from iam.contrib.iam_migration.migrator import IAMMigrator


def init_iam(apps, schema_editor):
    migrator = IAMMigrator(Migration.migration_json)
    migrator.migrate()


class Migration(migrations.Migration):
    migration_json = "initial.json"

    dependencies = [
        ("apm_web", "0001_initial"),
    ]

    operations = [migrations.RunPython(init_iam)]
