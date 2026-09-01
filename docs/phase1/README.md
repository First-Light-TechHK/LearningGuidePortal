# Phase 1 工程入口

这里是 Learning Guide 生产网站 Phase 1 的工程文件入口。KS 不是独立产品；KS Phase 2 只增强 `Study`、`Understanding/Assessment` 和 `AI Tutor`。

## 文件顺序

| 文件 | 用途 |
|---|---|
| `source-prd/*.docx` | 七份原始 PRD，只作为需求来源 |
| `requirements-map.md` | 把 PRD 条目落到页面、服务、数据和测试 |
| `domain-model.md` | 表、字段、关系和状态变更 |
| `api-contracts.md` | API 输入、输出、权限和错误 |
| `release-runbook.md` | DEV、SIT、UAT、PPE/PROD 和回滚 |
| `backbone.md` | 第一条可运行产品切片和后续开发顺序 |
| `ai-coding-prompt.md` | 分配给 AI coding tool 的任务格式和固定约束 |
| `Learning_Guide_Phase1_Production_GoLive_Developer_Plan_ZH_v6.docx` | 面向开发人员的完整中文实施计划和架构图 |
| `architecture/Learning_Guide_Phase1_Production_Architecture_GPT_Image2.png` | 生产架构图源文件 |

## 需求文件和项目决定的区别

七份 PRD 定义产品要求。`AGENTS.md`、`DESIGN.md` 和本目录文件定义实现方式。开源项目的做法只作为实现参考，不会自动变成 Learning Guide 的产品需求。遇到冲突时，先保留 PRD 要求，再由负责人确认实现取舍，并更新 `requirements-map.md`。

## 当前开发阶段

当前提交是可运行的工程骨架，不代表七份 PRD 已全部完成。生产开发顺序是：User Registration/User Authentication → Course Management/Portal → Purchase/Payment/Subscription/Order → My Learning/Study → AI Tutor 接入 → Reporting 和发布验收。
