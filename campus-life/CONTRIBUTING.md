# 协作约定

## 分支

- `main`：可运行版本，只通过 Pull Request 合入。
- `feature/场景或功能`：新功能，例如 `feature/library-story`。
- `fix/问题`：修复，例如 `fix/player-collision`。

## 提交前

1. 拉取最新 `main` 并处理冲突。
2. 运行 `npm test && npm run check && npm run build`。
3. 至少实际走通一次「选择角色 → 场景对话 → 属性变化」。
4. 改考试或结局时，额外走通一次完整学期。
5. 不提交个人 AppID、密钥和本地缓存。

## 内容格式

新故事放在 `EVENTS`，必须包含标题、地点、讲述者、正文与至少两个选项。属性使用 `knowledge`、`fitness`、`mood`、`social`、`practice`、`energy`，普通属性范围为 0–100。新建筑需要同时在 `BUILDINGS` 配置入口，并在渲染器中补充必要的个性化绘制。

## 代码评审

重点检查：是否可在小程序基础库运行、是否破坏既有测试、手机端文字是否溢出、剧情选项是否确实产生效果、建筑入口是否能够到达。
