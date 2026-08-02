# 三批改动的逐项回退

基线（三批之前）：`acc72c9`

| 项 | 内容 | 提交 |
|---|---|---|
| 1 | 三道题改写 + 眉标 13 句轮换 + 选项精简 | `c6c97ab`、`39b5bba`、`998bba0` |
| 2 | 大标题合成加粗（贴近 logo 重量） | `0fe0a21` |
| 3 | 进度文案烘焙口径 + 结果卡配方化 | `c766c47` |

## 回退第 2 项（字体）

```bash
git revert --no-edit 0fe0a21
```
实测：revert 干净，tsc 0 / vitest 181。

## 回退第 3 项（进度 + 配方卡）

```bash
git revert --no-edit c766c47
```
实测：revert 干净，tsc 0 / vitest 181。

## 回退第 1 项（题目 + 眉标）

**不能**直接 `git revert c6c97ab 39b5bba 998bba0` —— 第 3 项后来改了
`ui.ts` / `HbtiExperience.tsx` 的相邻区域，会冲突。用这个补丁，它只撤第 1 项、
保留第 2 与第 3 项：

```bash
git apply hbti-web/docs/rollback/item1-only-revert.patch
git add -A && git commit -m "回退第 1 项"
```
实测：应用干净，tsc 0 / vitest 181；回退后确认第 2 项（Neutra Display）
与第 3 项（进度双轨、配方卡文案）均完好。

> 若三项都要回退，倒序即可，实测干净：
> `git revert --no-edit c766c47 998bba0 39b5bba c6c97ab 0fe0a21`

## 回退后务必

```bash
cd hbti-web && npx tsc --noEmit && npx vitest run && npx next build
npx vercel --prod --yes
npx vercel alias set <新部署URL> hbti-test.hotcrush.net --scope algersss-projects
```
