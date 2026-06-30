## 变更说明 / Description

<!-- 简述本次 PR 的内容和目的 / Briefly describe the changes and purpose of this PR -->

## 关联 Issue / Related Issue

Closes #

## 变更类型 / Type of Change

- [ ] Bug 修复 / Bug fix
- [ ] 新功能 / New feature
- [ ] 重构 / 优化 / Refactor / Optimization
- [ ] 文档 / 测试 / Documentation / Tests
- [ ] 构建 / CI / Build / CI

## 本地验证 / Local Verification

```bash
# 完整验证（含 250w 行重型解析 + 服务器冒烟）
bash test/validate.sh --force

# 快速验证（跳过服务器冒烟）
bash test/validate.sh --fast --force
```

## 检查清单 / Checklist

- [ ] 代码风格与项目一致 / Code style matches project conventions
- [ ] 全量验证通过 / Full validation passes (`validate.sh`)
- [ ] 重型解析 250w 行验证通过 / Heavy 2.5M-line parsing test passes
- [ ] 虚拟滚动审计通过 / Virtual scroll audit passes
- [ ] 新功能已在本地浏览器中手动测试 / Manually tested in browser

## 补充说明 / Additional Notes

<!-- 其他需要 reviewer 了解的信息 / Any additional information for reviewers -->
