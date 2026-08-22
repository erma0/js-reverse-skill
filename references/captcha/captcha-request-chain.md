# 验证码请求链通用模型

> **交叉引用**：边界与分工见 `captcha-overview.md`；厂商参数细节见 `captcha-providers.md`；Session 绑定通用规则见 `network/session-chain.md`；四层链路方法论见 `crypto/crypto-entry.md`。

验证码逆向与普通签名逆向的最大区别：**参数清单天然是两组**（load 组 + verify 组），且 challenge 一次性、强绑定 Session。分析前先画出本 case 的完整链路图，再逐环节做 source→entry→builder→writer 定位。

## 三段式通用链路

```text
① load/register   页面/业务方初始化，拿到 challenge 标识 + 素材地址
② solve           本地求解答案（ddddocr/打码），生成轨迹
③ verify          提交加密答案 + 加密轨迹，换取通过凭据（validate/ticket/seccode）
                  → 业务接口消费凭据
```

**硬规则**：challenge 一次性。每次验证必须从 ① 完整重走；复用旧 challenge 必然失败（这是最常见的"算法对了但不过"原因）。

**凭据 TTL 与一次性实测**：③ 拿到通过凭据后、写入交付逻辑前，先测一次有效期与消费语义——延迟数秒提交看是否过期、二次提交看是否单次消费（部分凭据一次性，参考案例踩坑）。不测会把「凭据已过期/已消费」误判成业务接口签名错误。

## 骨架案例：极验 v3 滑块

```text
register?t=<gt>            → { challenge, gt, success }
ajax.php?gt&challenge&lang&pt=0&w=&callback=  → 初始化会话（必经，跳过则后续 get/ajax 全 error_31）
gettype.php?gt&callback    → 题型声明
get.php?gt&challenge&...   → { fullbg, bg, slice, challenge, xpos, ypos, ... }
ajax.php?gt&challenge&lang → 提交 w（加密答案+轨迹，必须 GET + JSONP callback；POST 返回 error_31）→ { validate } 或失败
业务接口                    → 携带 seccode = validate + "|jordan" 消费
```

w 参数明文结构示意（AES 加密明文，AES key 再 RSA 加密；**字段名与构成以每 case 的 RuyiTrace dump 为准，不同版本有差异，禁止照抄**）：

```json
{
  "userresponse": "<答案归一化值，滑块即缺口偏移换算>",
  "passtime": "<滑动总耗时 ms>",
  "imgload": "<图片加载耗时>",
  "ep": "<环境/版本相关字段>",
  "lang": "zh-cn",
  "rp": "<md5(gt + challenge[:32] + h9s9) 形态的校验值；v3 实测为 h9s9（10 位数字串）非 passtime，以 case trace 为准>",
  "aa": "<轨迹数组：相对位移 x,y,t 序列，字段名以 trace 为准>"
}
```

## 骨架案例：极验 v4

```text
load?captcha_id&challenge&...  → { lot_number, 素材(bg/slice), payload, process_token, ... }
verify?captcha_id              → 提交 w（含 lot_number、pow_msg/pow_sign、加密轨迹、答案）
                               → { seccode: { pass_token, gen_time, captcha_output, lot_number } }
业务接口                        → 携带 lot_number / captcha_output / pass_token / gen_time
```

v4 与 v3 差异：`captcha_id` 替代 `gt`；w 内嵌 PoW 字段（pow_detail/pow_msg/pow_sign）；通过凭据是 seccode 四件套，**四件都要传给业务接口**，缺一即失败。

## 四层链路定位表（每 case 必填）

| 参数 | source | entry | builder | writer |
|---|---|---|---|---|
| gt / captcha_id | 业务页配置或接口下发 | 初始化函数 | 固定配置 | load URL query |
| challenge / lot_number | register/load 响应 JSON | — | 服务端生成 | 后续所有请求 query + w 明文内 |
| 素材 URL (bg/slice) | get/load 响应 JSON | — | 服务端生成 + 路径混淆 | `<img>` / canvas，需还原完整 URL |
| 答案 (distance/points) | 本地求解 | ddddocr/打码 | answer JSON | w 明文内（加密前） |
| 轨迹 | 轨迹生成脚本 | mousemove 采集逻辑（取证时 hook） | 相对位移数组 + 时间戳 | w 明文内（加密前） |
| w | 以上全部 | **加密入口函数（逆向核心）** | AES(+RSA) 或自定义 | verify 请求 body/query |
| validate/seccode | verify 响应 JSON | — | 服务端生成 | 业务接口 body/cookie |

## 证据要求

1. **成功链路 trace 是核心证据**：让用户在取证环境手动过一次验证码，RuyiTrace 采完整 NDJSON；再采一条失败链路（或程序模拟的失败请求）。对比两者差异定位校验点。
2. 素材图必须落盘 `case/forensic/`（bg/slice/fullbg 原始字节），用于本地求解调试，禁止反复向 load 接口刷图。
3. 多次（≥3）完整链路对比，确认变化因子：challenge、素材、轨迹、时间戳、w。
4. 轨迹采集点 hook（mousedown/mousemove/mouseup）必须在 SDK 加载前安装（经验法则 #1），否则签名函数已执行、轨迹数组已加密，hook 失效。
