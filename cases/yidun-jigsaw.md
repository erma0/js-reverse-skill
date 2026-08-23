# Case：网易易盾滑块(check) 参数逆向（d/m/p/f/ext + SDK 阶梯轨迹 + 纯协议 3/3 通过）

> 难度：★★★★
> 还原方案：A 纯算还原（d/p/f/ext 加密链，core-optimi 模块 vm 提取）+ 打码坐标输入
> 实现语言：Node.js
> 最后验证日期：2026-08-09
> 平台类型：网易易盾（dun.163.com，滑块 type=2）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`core-optimi.m25b40.*.min.js`（webpack 模块化：0xa 含 xorEncode/aes，0x3 含 sample/uuid，0x38 含 mod38）
- 参数特征：`data` 参数 = JSON `{d,m,p,f,ext}` 全 AES 密文；**`m` 固定空串 `""`**；callback=`__JSONP_`+7 位随机+`_`+数字
- 请求特征：`/api/v2/getconf`（拿 dt）→ `/api/v3/get`（challenge+bg/front+token）→ `/api/v3/check`（JSONP script 标签，XHR hook 捕获不到）
- 指纹特征：cookie `gdxidpyhxdE` 与 get 参数 `fp` 尾部时间戳同源；irToken 一次性

## 加密方案

- 路径：A 纯算还原（从 core-optimi 提取 xorEncode/aes/sample/mod38/uuid 复用，不复写算法）
- 框架：vm.createContext（仅提取加密函数）
- TLS 客户端：Node.js https（无需 TLS 指纹模拟）
- 核心思路：getconf 拿 dt → get 拿 challenge → 打码/人工给 jigsaw.left → 生成 SDK 阶梯轨迹 → 逐字段加密 → check；坐标误差用 ±扫描兜底

## 踩坑记录

1. **坑：`m` 字段写成数字 0** → 正确做法：真实 SDK 全部样本均为空串 `""`，写 0 全量 result:false（曾掩盖后续所有排除实验）
2. **坑：人工/打码坐标误差 6-13px，单点提交必 false** → 正确做法：验证默认 SCAN_PX≥8 逐 px 扫描（点击 207 vs 真实 213）
3. **坑：轨迹移动步固定 2-4px** → 正确做法：移动步长自适应距离（150px→5-6px、102px→2-4px），点数由时长决定（40-55）非距离
4. **坑：fresh_fp.json 的 irToken 一次性** → 正确做法：浏览器真实 get 参数仅首轮可用，后续回落协议默认（自建 cb/fp）
5. **坑：callback 固定前缀** → 正确做法：`__JSONP_` + 7 位随机字母数字 + `_` + 数字
6. **坑：p 浮点尾巴**（42.18750000000001）→ 正确做法：先乘后除 + toFixed(4)
7. **坑：d 轨迹末点用移动距离** → 正确做法：d 末点 = jigsaw.left；slider.left = jigsaw.left - 10.5
8. **坑：图像缺口检测不可靠**（拼图块重着色，偏差 12-145px）→ 正确做法：打码平台坐标或浏览器扫描定位

## 可验证事实清单（经验资产）

1. check 的 `data.m` 恒为空串 `""`（6 份真实样本一致：final_success/scan_success/live2/step5/diag/sdk）
2. `p` 明文 = parseInt(slider.left)/320*100 + toFixed(4)，slider.left = jigsaw.left - 10.5
3. `d` = aes(sample(traceData,50).join(':')), traceData 为 xorEncode(token,"x,y,t,1")
4. `f` = aes(xorEncode(token, mod38(unique2DArray(atomTraceData,2)).join(',')))
5. `ext` = aes(xorEncode(token, '1,'+traceData.length))
6. mod38 = 47 特征（uniqueX/uniqueY/meanY/stdY/n + vx/vy/vdist/ax/ay/adist 各 7 项）
7. d 加密长度：42 点=1032、40 点=944、50 点=1200；p=92、f=432、ext=92
8. 轨迹点数由时长决定：42 点/1829ms、50 点/2337ms，间隔约 45ms/点
9. 轨迹 X 末点 = jigsaw.left（252.5↔p75.625、146↔p42.1875 实测一致）
10. 人工坐标误差实测 6-13px（点击 207 vs 真实 213、197 vs 201、155 vs 168）

## 轨迹参数包（track-profile.json，T2 实证参数固化）

由上述实测提炼，落在 case 的 `result/src/track-profile.json`（T2 实测参数只进 case adapter，脚本/模板不内置厂商预设——SKILL.md T1/T2 政策）：

```json
{
  "model": "staircase",
  "duration_ms": 2000,
  "move_interval_ms": [50, 70],
  "adjust_interval_ms": [17, 27],
  "adjust_step_px": 1,
  "first_x": 5,
  "first_t_ms": [146, 250],
  "_meta": {
    "case": "yidun-jigsaw",
    "verified": "2026-08-09",
    "notes": "点数由时长决定（40-55 点/1.8-2.5s）；移动步长自适应公式已内置；SDK 更新后必须重跑 analyze_track.py 对新成功样本复核，禁止直接沿用"
  }
}
```

生成与复核（`--distance` 每次 challenge 单独传，`slider.left = jigsaw.left - 10.5`）：

```bash
python scripts/generate_motion_track.py --mode slider --model staircase \
  --profile result/src/track-profile.json --distance <jigsaw.left> --pretty
python scripts/analyze_track.py --input <成功样本明文.json> --compare <生成输出.json> --pretty
```

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/captcha/captcha-providers.md` | 易盾厂商段（data 结构/m 空串/滑块实证） |
| `references/captcha/captcha-motion-encryption.md` | 易盾阶梯轨迹特征 + 验证铁律 |
| `references/captcha/verification-workflow.md` | 协议验证坐标扫描 + 全字段解密 |
