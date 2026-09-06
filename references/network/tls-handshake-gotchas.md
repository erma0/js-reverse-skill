# TLS 握手级残差：JA4 已对齐仍被拦的真因

**读取时机**：DIAGNOSE 三级客户端阶梯已走到第三级，且按 `tls-validation.md` 完成 JA3/JA4/key_share/HTTP2 Akamai/Header 顺序对齐后，真实请求**仍**被风控拦截时。本文只补"对齐后残差"，对齐主流程以 `tls-validation.md` 为准。

经验源：yazong 博客《TLS/JA4 指纹原理/获取/解析/风控实现与对抗》（2026-09 对照分析入库）。核心认知：**JA3/JA4 不是官方规范，握手包里还有它们没用到的字段；JA4 字符串一致 ≠ 字节级一致**。曾有实测：ja4 两端完全一致、请求仍失败，抓包对才发现差异在记录层。

## 三个握手级差异点

### 1. ClientHello 记录层分段
- 真实 Chrome 对握手报文**分片发送**（多条 TLS record）；多数脚本栈（tls_client、各语言默认 TLS 库）**整条发出**。
- 分段的根源常是第 2 点：Chrome 扩展总长度显著更长，超过单 record 容量。
- 对拍方法：wireshark 过滤 `ssl.handshake.type == 1`，对比两端 record 数量与分片边界。

### 2. Key Share 混合算法（PQC）
- 新版 Chrome key_share 用 **x25519+kyber768（ML-KEM 混合）**；多数库实现仅传统 x25519 → key_share 扩展长度/条目数不同。
- curl_cffi 可用 `extra_fp` + `curl_options`（如 `CurlOpt.TLS_KEY_SHARES_LIMIT`）逼近，见 `tls-validation.md` Firefox 对齐模板；对不齐时记录能力边界，不伪造成功。

### 3. TCP 序列号
- 脚本栈每次握手 TCP seq 恒为 1；真实浏览器为变化值。属 TCP/IP 层指纹（与 TTL、窗口大小、MSS 同族，见 `network/ip-risk-control.md`），需改系统网络栈或定制内核请求库才能对齐，常规 curl_cffi/cycleTLS 无能为力——先确认风控是否真的校验这一层，不要盲目下沉。

## 诊断流程

```
JA4 已按 tls-validation.md 对齐仍 403
  → wireshark 抓两端 ClientHello（浏览器 baseline vs 交付客户端）
  → 依次对拍：① record 分段数量 ② key_share 条目（x25519 vs x25519+kyber768）③ TCP seq
  → 每项差异单独验证（单变量原则）：改一项、重放、看结果
  → 全部对齐仍失败 → 回 ip-risk-control.md 查 IP/速率层，勿再怀疑签名
```

**先确认校验存在，再投入对齐**：上述三项的对抗成本依次陡增（① 可用支持分片的客户端解决、② 需库支持 PQC 混合、③ 需定制网络栈）。用"仅改这一项是否由拒转过"的单变量实验确认服务端真的校验它，避免过度工程。
