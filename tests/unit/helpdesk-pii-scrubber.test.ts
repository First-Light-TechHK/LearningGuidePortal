// Helpdesk v5 Part G2: the code-only PII scrubber. Only scrubbed text ever
// leaves Portal for mining (the insights feed), and after 180 days the raw
// learner text in the assist log is replaced by it. The corpus covers
// Simplified and Traditional Chinese, English and mixed text, full-width and
// other non-ASCII digits, invisible characters between digits, the formats of
// mainland China, Hong Kong, Taiwan and the UK, and the learner's own name and
// email from their account. Text with nothing personal is left as typed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PII_PLACEHOLDERS, scrubPii, scrubPiiReport, type ScrubContext } from "../../modules/helpdesk/piiScrubber";

type Case = [input: string, expected: string, context?: ScrubContext];

const ZH_CN: Case[] = [
  ["我的手机号是13800138000，收不到验证码", "我的手机号是<phone>，收不到验证码"],
  ["电话 138 0013 8000 打不通", "电话 <phone> 打不通"],
  ["+86 138-0013-8000", "<phone>"],
  ["联系我 0086 13800138000", "联系我 <phone>"],
  ["86 13800138000 是我的号码", "<phone> 是我的号码"],
  ["座机 010-12345678", "座机 <phone>"],
  ["邮箱 zhangsan@qq.com 没收到邮件", "邮箱 <email> 没收到邮件"],
  ["我的邮箱是ZhangSan_88@163.COM。", "我的邮箱是<email>。"],
  ["订单号 order_1761700000000_a1b2c3d4 付款失败", "订单号 <order> 付款失败"],
  ["订单号：202610290001234 一直显示待支付", "订单号：<order> 一直显示待支付"],
  ["交易号 4200001234202610291234567890 查不到", "交易号 <order> 查不到"],
  ["卡号 6222 0212 3456 7890 123 被扣了两次", "卡号 <card> 被扣了两次"],
  ["全角数字１３８００１３８０００", "全角数字<phone>"],
  ["学号 2023123456 登录不了", "学号 <student_id> 登录不了"],
  ["我叫张伟，账号登不上", "我叫<name>，账号登不上", { names: ["张伟"] }],
  ["我叫李小龙，不是本人账号", "我叫<name>，不是本人账号"],
  ["孩子叫王小明，他的课程打不开", "孩子叫<name>，他的课程打不开"],
  ["链接 https://www.ilovelearningguide.com/zh-CN/reset?token=abc123def456 打不开", "链接 <url> 打不开"],
  ["打开 https://www.ilovelearningguide.com/zh-CN/account 没反应", "打开 https://www.ilovelearningguide.com/zh-CN/account 没反应"],
  ["尾号 1234 的卡被扣款", "尾号 <card> 的卡被扣款"],
  ["2026-10-29 扣了 199.00 元", "2026-10-29 扣了 199.00 元"],
  ["10月29号扣了两次，每次 199 元", "10月29号扣了两次，每次 199 元"],
  ["验证码 482913 输入后没反应", "验证码 <number> 输入后没反应"],
  ["微信号 zhang_san88 加我", "微信号 <handle> 加我"],
  ["QQ 12345678 联系", "QQ <handle> 联系"],
  ["幺三八零零幺三八零零零 是我电话", "<number> 是我电话"],
  ["怎么取消订阅？", "怎么取消订阅？"],
  ["我付了两次 199 元，第 3 节课打不开", "我付了两次 199 元，第 3 节课打不开"]
];

const ZH_TW: Case[] = [
  ["我的手機是 0912-345-678，收不到簡訊", "我的手機是 <phone>，收不到簡訊"],
  ["香港電話 +852 9123 4567", "香港電話 <phone>"],
  ["(852) 9123-4567", "<phone>"],
  ["（852）9123 4567 請回電", "<phone> 請回電"],
  ["852-9123 4567", "<phone>"],
  ["我的電話係 91234567", "我的電話係 <phone>"],
  ["台灣 +886 912 345 678", "台灣 <phone>"],
  ["我的工單 LG-261029-0012 沒人回覆", "我的工單 <ticket> 沒人回覆"],
  ["信箱 chen.mei@gmail.com 收不到信", "信箱 <email> 收不到信"],
  ["學號：B11002034 無法登入", "學號：<student_id> 無法登入"],
  ["我叫陳美玲，帳號被鎖", "我叫<name>，帳號被鎖", { names: ["陳美玲"] }],
  ["美玲的課程打不開", "<name>的課程打不開", { names: ["陳美玲"] }],
  ["卡號４１１１－１１１１－１１１１－１１１１被扣款", "卡號<card>被扣款"],
  ["訂單編號：２０２６１０２９０００１２３４", "訂單編號：<order>"],
  ["驗證碼 004417", "驗證碼 <number>"],
  ["怎麼取消訂閱？", "怎麼取消訂閱？"]
];

const EN: Case[] = [
  ["My email is Oliver.Zhang@Example.co.uk and I can't log in", "My email is <email> and I can't log in"],
  ["Call me on +44 7700 900123", "Call me on <phone>"],
  ["my mobile is 07700 900123", "my mobile is <phone>"],
  ["Card 4111 1111 1111 1111 was charged twice", "Card <card> was charged twice"],
  ["Amex 3782 822463 10005 declined", "Amex <card> declined"],
  ["Order #pi_3NqX8L2eZvKYlo2C1abcdEFG failed", "Order #<order> failed"],
  ["receipt cs_test_a1B2c3D4e5F6g7H8 missing", "receipt <order> missing"],
  ["My name is Oliver Zhang and I need help", "My name is <name> and I need help"],
  ["hi, oliver here, still Basic", "hi, <name> here, still Basic", { names: ["Oliver Zhang"] }],
  ["ZHANG paid twice", "<name> paid twice", { names: ["Oliver Zhang"] }],
  ["Reset link https://example.com/reset/9f8e7d6c5b4a39281706f5e4d3c2b1a0 expired", "Reset link <url> expired"],
  ["see www.example.com/pay?session=xyz.", "see <url>."],
  ["https://user:secret@example.com/path is broken", "<url> is broken"],
  ["user id user_1761700000000_a1b2c3d4", "user id <student_id>"],
  ["student number: 20231234", "student number: <student_id>"],
  ["ip 192.168.1.20 blocked", "ip <ip> blocked"],
  ["Chrome 118.0.5993.88 on Windows 11", "Chrome 118.0.5993.88 on Windows 11"],
  ["zhangsan at qq dot com", "<email>"],
  ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "token <token>"],
  ["api key zz9fake0token0for0scrubber0tests0only", "api key <token>"],
  ["my login lin.learner42 fails", "my login <email> fails", { emails: ["lin.learner42@example.test"] }],
  ["LIN.LEARNER42@EXAMPLE.TEST is my account", "<email> is my account", { emails: ["lin.learner42@example.test"] }],
  ["ticket 3f2a1c4e-9b8d-4e7f-a6b5-c4d3e2f1a0b9 is open", "ticket <id> is open"],
  ["the code ending in 4242 failed", "the code ending in <card> failed"],
  ["How do I cancel my subscription?", "How do I cancel my subscription?"],
  ["I paid £19.99 on 29/10/2026 at 10:30", "I paid £19.99 on 29/10/2026 at 10:30"],
  ["My order is still pending since 2026-10-28 09:15", "My order is still pending since 2026-10-28 09:15"],
  ["In order to watch lesson 12, what do I do? Chrome on Windows 11", "In order to watch lesson 12, what do I do? Chrome on Windows 11"],
  ["wechat pay failed with the code not working", "wechat pay failed with the code not working"],
  ["visit learningguide.com/help or https://youtu.be/dQw4w9WgXcQ", "visit learningguide.com/help or https://youtu.be/dQw4w9WgXcQ"]
];

const MIXED: Case[] = [
  ["我的email是 a.b@c.com, phone 13800138000 谢谢", "我的email是 <email>, phone <phone> 谢谢"],
  ["订单 order_1761700000000_a1b2c3d4 paid but 没开通", "订单 <order> paid but 没开通"],
  ["138​0013​8000 打不通", "<phone> 打不通"],
  ["电话　138　0013　8000", "电话　<phone>"],
  ["phone: ١٣٨٠٠١٣٨٠٠٠", "phone: <phone>"],
  ["我叫 Lin Learner, email lin@example.test", "我叫 <name>, email <email>", { names: ["Lin Learner"], emails: ["lin@example.test"] }],
  ["Hi I'm 小明, 我的 student id 是 S1234567", "Hi I'm <name>, 我的 student id 是 <student_id>", { names: ["王小明"] }],
  ["链接 www.ilovelearningguide.com/zh-CN/subscription 显示 error", "链接 www.ilovelearningguide.com/zh-CN/subscription 显示 error"],
  ["2026/10/28 10:30 打了 13800138000 没人接", "2026/10/28 10:30 打了 <phone> 没人接"],
  ["看不到第12课，版本 5.2.1，价格是 1299.00 元", "看不到第12课，版本 5.2.1，价格是 1299.00 元"]
];

const ALL = [...ZH_CN, ...ZH_TW, ...EN, ...MIXED];

for (const [group, cases] of Object.entries({ "zh-CN": ZH_CN, "zh-TW": ZH_TW, en: EN, mixed: MIXED })) {
  test(`the scrubber corpus: ${group}`, () => {
    for (const [input, expected, context] of cases) assert.equal(scrubPii(input, context), expected, JSON.stringify(input));
  });
}

test("scrubbing is idempotent: scrubbed text is never changed again, placeholders included", () => {
  for (const [input, , context] of ALL) {
    const once = scrubPii(input, context);
    assert.equal(scrubPii(once, context), once, JSON.stringify(input));
  }
  // A learner whose name or email local part is a placeholder word cannot break the placeholders.
  const once = scrubPii("email me: a@b.com, phone 13800138000", { names: ["email", "phone"], emails: ["phone@example.test"] });
  assert.equal(once, "<name> me: <email>, <name> <phone>");
  assert.equal(scrubPii(once, { names: ["email", "phone"], emails: ["phone@example.test"] }), once);
});

test("the report counts what was replaced, by placeholder, and never repeats the text it removed", () => {
  const report = scrubPiiReport("邮箱 a@b.com，电话 13800138000，另一个 13900139000，卡 4111 1111 1111 1111");
  assert.equal(report.text, "邮箱 <email>，电话 <phone>，另一个 <phone>，卡 <card>");
  assert.deepEqual(report.found, { email: 1, phone: 2, card: 1 });
  assert.deepEqual(scrubPiiReport("怎么取消订阅？").found, {});
  for (const placeholder of PII_PLACEHOLDERS) assert.match(placeholder, /^<[a-z_]+>$/);
});

test("no digit run of six or more, email or link with a query survives anywhere in the corpus", () => {
  for (const [input, , context] of ALL) {
    const output = scrubPii(input, context);
    assert.doesNotMatch(output.normalize("NFKC").replace(/[\s​]/g, ""), /\p{Nd}{6,}/u, `${input} -> ${output}`);
    assert.doesNotMatch(output, /[^\s<]+@[^\s>]+\.[a-z]{2,}/i, `${input} -> ${output}`);
    assert.doesNotMatch(output, /https?:\/\/\S*\?/i, `${input} -> ${output}`);
  }
});

test("the scrubber is pure: same input, same output, and long input is handled in bounded time", () => {
  const long = `${"我的电话是 13800138000，邮箱 a@b.com。".repeat(500)}${"x".repeat(5000)}`;
  const started = Date.now();
  const output = scrubPii(long);
  assert.ok(Date.now() - started < 2000, "linear enough for a 5000-character row");
  assert.equal(output, scrubPii(long));
  assert.ok(!output.includes("13800138000"));
  assert.equal(scrubPii(""), "");
});

test("a long list of short numbers split by spaces is scrubbed in bounded time", () => {
  for (const long of ["1  ".repeat(2000), "12 34 ".repeat(1500), "第 3 课 4 题 ".repeat(800)]) {
    const started = Date.now();
    const output = scrubPii(long);
    assert.ok(Date.now() - started < 1000, `bounded for ${JSON.stringify(long.slice(0, 12))}`);
    assert.equal(output, scrubPii(long));
  }
});
