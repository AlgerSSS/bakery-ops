# HBTI 文案重设计方案 —— 「货架上的 16 种人」

> 2026-07-31 · 纯文案方案,不含任何代码改动。
> 范围:全部界面文字、题目与选项、16 种结果的完整人格重写(含虚拟画像)。
> 交付原则:每一段文字都标注了它对应 `src/content/` 里的哪个字段,照抄即可落地。

---

## 〇、一页摘要

**改什么:** 把一个「答题领券的咖啡问卷」改成一个「认领自己是哪块面包」的人格测试。
咖啡退到配角,**面包成为人格本体**——我们是面包店,货架就是我们的十六宫格。

**三个核心动作:**

1. **世界观换轴**——从「你是哪种咖啡人」变成「货架上有 16 种性格,每天新鲜出炉,哪一块是按你的样子烤的?」测试的主角从商品变成人。
2. **16 型全部重写**——每一型 = 一块面包化身 + 一段有画面的人格画像 + 一句可以发朋友圈的「认领句」。面包的物理特征就是性格隐喻(碱水结的结=抗压,巴斯克的焦壳=外冷内软),让「准」和「好玩」同时成立。
3. **动机反转**——奖励从头条降级为 P.S.(「顺便说一句,柜台有份小心意」)。让人来测的理由是「我想知道我是哪块」,不是「测完给东西」。

**不改什么:** 四轴字母(I/H·L/S·B/D·A/T)、16 个代码、评分逻辑、专属搭配里的真实菜单、隐私文案语义、`authTitle`(「Freshly made. Unmistakably you.」——e2e 钉死且本身很好)。

**题目:** 完整版 **13 题**(每轴 3 题多数决,更准);其中标 ★ 的 6 题构成**零代码替换子集**,可先行上线。

---

## 一、调研:MBTI 为什么火,SBTI 为什么火

### 1. MBTI:一张「社交名片」的诞生

综合[人民论坛的分析](https://www.rmlt.com.cn/2024/0401/699212.shtml)、[凤凰网的报道](https://gs.ifeng.com/c/8ss6CVhjZ2Z)和[传播学研究](https://m.fx361.com/news/2024/0821/24696422.html),MBTI 在中文互联网爆发(2022 冬奥谷爱凌自称 INTJ 是引爆点,次年受众覆盖率达 10%)靠的是四件事:

| 机制 | 说明 | 对 HBTI 的启示 |
|---|---|---|
| **身份的语言** | 四个字母给了年轻人一套谈论自己的现成词汇,「i 人 e 人」成了日常用语 | HBTI 代码要能被**读出口**、当梗用——面包名比字母更好念 |
| **社交货币** | 报出类型=低成本自我暴露,同类型=快速找到组织 | 每一型都要有「@你的碱水结朋友」这种点名机制 |
| **零门槛的心理学** | 几分钟拿到一个关于「我是谁」的答案,快节奏生活里的自我确认 | 测试必须短、顺、无注册摩擦(我们已满足) |
| **只有人设,没有差评** | 16 型没有「坏结果」,每型都值得认领 | 16 块面包**没有一块是次品**——每型的画像都必须让人愿意转发 |

### 2. SBTI:零奖励也能挤崩服务器

[SBTI(「傻乎乎的大人格测试」)](https://baike.baidu.com/item/SBTI%E6%B5%8B%E8%AF%95/67598800)是 2026 年 4 月 B 站 UP 主「Q肉儿串儿」做的戏仿版测试:**31 道题、免费、无注册、无任何奖励**,结果是「吗喽」「死者」「送钱者」这类自嘲标签,[朋友圈和小红书被刷屏,页面一度被挤崩](https://jsnews.jschina.com.cn/jsyw/202604/t20260410_s69d8f09be4b0639de44f5a0b.shtml)。[知乎的复盘](https://zhuanlan.zhihu.com/p/2025913450363101825)把它的火归结为三点:

1. **巴纳姆效应 + 生活化细节**——题目全是具体场景,人人能对号入座,「准」的体感来自画面而非量表;
2. **自嘲即释放**——认领一个标签=卸下心理负担,情绪价值本身就是奖品;
3. **标签即梗**——结果名足够怪、足够短,天然适合当头像、发群里、互相认领。

**最重要的实证:31 道题没有拦住任何人。** 题多不是流失点,**每道题不好玩才是**。这直接支持「加题提准度」的决定。

### 3. 两条结论,一个分寸

- **借 SBTI 的「认领感」**:结果必须是一个让人脱口而出「这也太我了」的**具体角色**,不是一段星座话术;
- **弃 SBTI 的「毒舌」**:它靠自嘲宣泄,我们是面包店——**面包店的职责是安慰**。HBTI 的准应该是「被温柔地看见」,带一点点戏,但绝不刻薄。

> 一句话方法论:**SBTI 让你笑着骂自己,HBTI 让你笑着认出自己。**

---

## 二、六条设计原则(每条都能倒查到上面的调研)

1. **测人,不测消费。** 每道题问的是「你怎么活」,面包和咖啡只是语言。商品问卷味 = 死。
2. **两个选项都体面。** 没有正确答案,也没有无聊答案——每个选项都是一种值得认领的活法。
3. **具体到有画面。** 「杯壁上那层冷汗」胜过「你喜欢冷饮吗」。画面感是「准」的体感来源。
4. **答题即轻微自我暴露。** 好的题让人停半秒、承认一件小真话——这半秒就是参与感。
5. **结果是社交货币。** 面包名要短、要怪得可爱、要能@朋友;认领句要能直接当文案发。
6. **奖励是 P.S.,不是标题。** 券只在完成后温柔出现。动机链:好奇 → 被看见 → 想分享 →(顺便)领礼物。

---

## 三、世界观与口吻

**HBTI = Hot-crush Bread Type Indicator。**
设定一句话:**「每天清晨,我们把 16 种性格烤进面包;总有一块,和你同名。」**

**口吻三条军规:**
- 像店员,不像品牌部:说人话,带热气,允许一点点调皮;
- 永远站在顾客那边:不评判、不爹味、不販卖焦虑;
- 每屏最多一个比喻,点到即止——温度来自克制。

**四轴的新说法**(对应 `results.ts` 的 `traitLabels`,8 个词整体替换):

| 轴 | 旧 | 新(zh) | 新(en) | 新(ms) | 含义转向 |
|---|---|---|---|---|---|
| I | 冰饮 | 冰系 | Iced | Ais | 从「点什么」变成「是什么人」:清醒、冷静面 |
| H | 热饮 | 暖系 | Warm | Hangat | 靠近就觉得暖的人 |
| L | 轻盈 | 轻盈 | Light | Ringan | 后劲型,留白多 |
| S | 浓烈 | 浓烈 | Bold | Pekat | 存在感藏不住 |
| B | 偏苦 | 回甘 | Bittersweet | Pahit-manis | 把「苦」说成有层次的褒义 |
| D | 偏甜 | 偏甜 | Sweet | Manis | 甜一点不丢人 |
| A | 独享 | 独享 | Solo | Bersendiri | 独处是充电不是孤僻 |
| T | 同行 | 同频 | In-sync | Sefrekuensi | 比「一起」更潮的说法 |

---

## 四、题目:13 题完整版(含 ★ 零代码子集)

**结构:** 4 轴 × 3 题 = 12 道计分题(**每轴多数决,3 票无平票**;三道题分别从「感官/自我认知/行为」三个角度测同一轴,单题误判会被另外两题纠正——这是「准」的来源),外加 1 道不计分的「打包题」(沿用现有 q6,提供数据与收尾趣味)。每题一行,选项不超过 14 个字——这是「简」的来源。

**★ = 零代码替换子集**:6 道题按现有 `q1–q6` 的 id 与取值一一对应,今天就能只换文案上线。其余 7 题需要在 `questions.ts`/`scoring.ts` 增加字段(改动很小,但按约定本方案不动代码,仅在附录标注改法)。

**推荐出题顺序**(节奏:四轴轮转,私密度递进,时段题倒数第二作情绪落点,打包题收尾):
T1 → S1 → D1 → A1 → T2 → S3 → D2 → A3 → S2 → D3 → A2 → T3 → 打包

### 温度轴(H 暖系 / I 冰系)

**T1 ★(=q1,hot/iced)· 场景:被安慰的方式**
- zh 「辛苦一天之后,你更想被怎样安慰?」
  - 🔥 hot 「递来一杯烫的:『慢慢喝,不急。』」
  - 🧊 iced 「递来一杯冰的:『醒一醒,没事了。』」
- en "After a long day, which comfort do you want handed to you?"
  - 🔥 "Something hot: 'Slow down. No rush.'"
  - 🧊 "Something iced: 'Wake up. It's fine now.'"
- ms "Selepas hari yang panjang, pujukan mana yang anda mahu?"
  - 🔥 "Yang panas: 'Minum perlahan, tak perlu terburu.'"
  - 🧊 "Yang sejuk: 'Sedarlah, semuanya okey.'"
- 设计注:把温度写成两种**安慰的语气**。选项自带对白,是全卷第一处「有人对你说话」的瞬间。

**T2 · 自我认知:别人眼中的你**
- zh 「朋友聊起你,更可能说你是——」
  - 🔥 hot 「靠近就觉得暖的人」
  - 🧊 iced 「越处越觉得清爽的人」
- en "When friends describe you, they'd say you're—"
  - 🔥 "Warm the moment someone gets close"
  - 🧊 "Refreshing the longer someone stays"
- ms "Bila kawan bercerita tentang anda, mereka kata anda—"
  - 🔥 "Terasa hangat sebaik didekati"
  - 🧊 "Semakin lama semakin menyegarkan"
- 设计注:两个选项都是夸法,选哪个都舒服——原则 2 的样板。

**T3 ★(=q5,morning/night;兼温度第三票:morning→H,night→I,与现行 fallback 一致)· 场景:最像自己的时刻**
- zh 「你觉得自己最像自己的时刻——」
  - 🌞 morning 「清晨,世界还没吵起来的时候」
  - 🌙 night 「深夜,世界终于安静下来的时候」
- en "You feel most like yourself—"
  - 🌞 "Early morning, before the world gets loud"
  - 🌙 "Late night, after the world finally quiets down"
- ms "Anda paling rasa diri sendiri—"
  - 🌞 "Awal pagi, sebelum dunia mula bising"
  - 🌙 "Larut malam, selepas dunia akhirnya senyap"
- 设计注:原「你最常几点来店」是运营问题;改成「何时最像自己」是身份问题——同一个数据,完全不同的答题体验。仍存 `visitTime` 供运营使用。

### 浓淡轴(S 浓烈 / L 轻盈)

**S1 ★(=q2,strong/light)· 场景:咖啡拟人(保留原题,微调)**
- zh 「如果咖啡是一个人,你希望他——」
  - ⚡ strong 「一开口就让你清醒」
  - 🌤 light 「陪你慢慢醒过来」
- en "If coffee were a person, you'd want them to—"
  - ⚡ "Wake you with the very first word"
  - 🌤 "Ease you into the day, no hurry"
- ms "Kalau kopi itu seseorang, anda mahu dia—"
  - ⚡ "Terus sedarkan anda dengan ayat pertama"
  - 🌤 "Temani anda bangun perlahan-lahan"
- 设计注:原卷最好的一题,原样保留。它证明这套卷子本来就有好底子。

**S2 · 自我认知:偏好的浓度**
- zh 「你喜欢的故事(和日子),最好——」
  - ⚡ strong 「浓一点,起伏大一点,才过瘾」
  - 🌤 light 「淡一点,留白多一点,才舒服」
- en "The stories (and days) you like best are—"
  - ⚡ "Rich and dramatic—make it count"
  - 🌤 "Light with room to breathe"
- ms "Cerita (dan hari) yang anda suka biar—"
  - ⚡ "Pekat dan penuh warna, baru puas"
  - 🌤 "Ringan dan berruang, baru selesa"

**S3 · 行为:进入新环境**
- zh 「到一个新环境,你通常——」
  - ⚡ strong 「存在感藏不住,很快被记住」
  - 🌤 light 「慢热,但后劲很长」
- en "In a new room, you usually—"
  - ⚡ "Can't hide—people remember you fast"
  - 🌤 "Warm up slowly, but you linger"
- ms "Dalam suasana baru, anda selalunya—"
  - ⚡ "Susah nak senyap—cepat diingati"
  - 🌤 "Lambat panas, tapi kesannya lama"
- 设计注:「后劲很长」把慢热写成优点——淡不是弱,是回味。

### 甜苦轴(D 偏甜 / B 回甘)

**D1 ★(=q3,dolce/bitter)· 立场:关于甜(保留原题精华)**
- zh 「关于『甜』,你的立场——」
  - 🍯 dolce 「生活已经够苦了,甜一点不丢人」
  - 🖤 bitter 「有点苦,才尝得出层次」
- en "Your official position on sweetness—"
  - 🍯 "Life's bitter enough. Sweet is allowed."
  - 🖤 "A little bitterness is what depth tastes like"
- ms "Pendirian anda tentang manis—"
  - 🍯 "Hidup dah cukup pahit. Manis itu halal."
  - 🖤 "Sedikit pahit, baru terasa lapisannya"
- 设计注:「生活已经够苦了」是原卷的金句,升级为「甜一点不丢人」——多了一层为自己辩护的温柔。

**D2 · 行为:安慰朋友的分工**
- zh 「朋友难过的时候,你负责——」
  - 🍯 dolce 「说甜的:先抱一下,天塌不下来」
  - 🖤 bitter 「说真的:苦口的那句,总得有人讲」
- en "When a friend is down, your job is—"
  - 🍯 "The sweet part: hug first, sky's not falling"
  - 🖤 "The honest part: someone has to say it"
- ms "Bila kawan sedih, tugas anda—"
  - 🍯 "Bahagian manis: peluk dulu, langit tak runtuh"
  - 🖤 "Bahagian jujur: ayat pahit itu perlu juga"
- 设计注:全卷情感浓度最高的一题,放在中段。答完这题,答题者已经在测试里「当了一次好朋友」。

**D3 · 自我认知:回忆的口味**
- zh 「回忆过去,你最先想起——」
  - 🍯 dolce 「那些甜的瞬间,哪怕当时很难」
  - 🖤 bitter 「那些来之不易的部分,苦得值得」
- en "Looking back, you remember first—"
  - 🍯 "The sweet moments, even in hard times"
  - 🖤 "The hard-won parts—bitter, but worth it"
- ms "Bila mengimbas kembali, anda teringat dulu—"
  - 🍯 "Saat-saat manis, walau masa itu susah"
  - 🖤 "Bahagian yang payah—pahit, tapi berbaloi"

### 独同轴(A 独享 / T 同频)

**A1 ★(=q4,alone/together)· 场景:刚出炉的那一口**
- zh 「刚出炉的那一口,你希望——」
  - 🎧 alone 「一个人慢慢来,不说话也不分享」
  - 👯 together 「掰一半给旁边的人,看他眼睛亮起来」
- en "That first warm bite is best—"
  - 🎧 "Alone, unhurried, no talking, no sharing"
  - 👯 "Split in half, watching someone's eyes light up"
- ms "Gigitan pertama yang masih panas paling sedap—"
  - 🎧 "Sendirian, perlahan, tanpa bicara"
  - 👯 "Dibahagi dua, melihat mata seseorang bersinar"
- 设计注:「看他眼睛亮起来」是全卷最暖的一个画面,放在第一轮,定调。

**A2 · 自我认知:充电方式(i 人 e 人的面包版)**
- zh 「你的充电方式——」
  - 🎧 alone 「独处:人多的场合费电」
  - 👯 together 「见人:安静太久会没电」
- en "How you recharge—"
  - 🎧 "Alone time. Crowds drain the battery."
  - 👯 "People time. Too much quiet drains it."
- ms "Cara anda mengecas semula—"
  - 🎧 "Bersendirian. Keramaian itu memenatkan."
  - 👯 "Berjumpa orang. Sunyi lama pun memenatkan."
- 设计注:直接借用「i 人 e 人」的国民语感,零学习成本,强认领感。

**A3 · 行为:空档周末**
- zh 「难得空出来的周末,你——」
  - 🎧 alone 「谁都别约我,我和自己有约」
  - 👯 together 「立刻翻通讯录:都出来!」
- en "A rare free weekend. You—"
  - 🎧 "Don't call me. I have plans with myself."
  - 👯 "Straight to the group chat: everyone out!"
- ms "Hujung minggu yang jarang-jarang lapang. Anda—"
  - 🎧 "Jangan ajak saya. Saya ada janji dengan diri sendiri."
  - 👯 "Terus buka group chat: semua keluar!"

### 打包题(★ =q6,drink/dessert/bakery,不计分)

- zh 「如果快乐可以打包,你带走——」
  - 🥤 drink 「一杯:能边走边喝的陪伴」
  - 🍰 dessert 「一块:留给今晚独处的仪式」
  - 🥐 bakery 「一袋:连明天早餐都照顾好」
- en "If happiness came in takeaway, you'd take—"
  - 🥤 "A cup: company you can carry"
  - 🍰 "A slice: tonight's little ceremony"
  - 🥐 "A bag: tomorrow's breakfast, already loved"
- ms "Kalau kebahagiaan boleh dibungkus, anda bawa—"
  - 🥤 "Secawan: teman yang boleh dibawa berjalan"
  - 🍰 "Sepotong: upacara kecil malam ini"
  - 🥐 "Sebungkus: sarapan esok pun sudah dijaga"
- 设计注:三个选项 = 三种照顾自己的方式。收尾题要轻,让人带着笑按下「出炉」。

---

## 五、16 种面包人格(完整画像)

**结构说明:** 每型包含——
- **名字**(入 `results.ts` 的 `name`,三语,中文 ≤7 字、英文 ≤24 字符,分享卡不换行);
- **画像**(入 `description`,中文 ≤75 字——正是让人截图的那段);
- **化身逻辑**(给团队和插画师看的一句话:为什么是这块面包,不进代码);
- **专属搭配**(`signatureOrder`,**维持现有真实菜单不变**,零风险;菜单变动时可自由替换);
- **认领句**(分享卡/社媒素材,现阶段不进代码);
- **插画 brief**(虚拟画像的视觉描述,供后续出图,统一风格见本节末尾)。

> 命名规律:面包 + 人设的四字~七字混合体,能直接当外号喊。十六块面包互不重复,共同构成一面「性格货架」。

---

### ILBA 清醒贝果 · The Clear-Eyed Bagel · Bagel Mata Jernih

- **画像 zh:** 你很少最先开口,但什么都看见了。不加糖、不凑热闹,你的冷静不是冷漠——是把力气留给真正重要的事。
- **en:** You're rarely the first to speak, but you see everything. No sugar, no fuss—your calm isn't coldness. It's saving your strength for what actually matters.
- **ms:** Anda jarang bersuara dulu, tapi semuanya anda nampak. Tanpa gula, tanpa gimik—ketenangan anda bukan dingin, cuma menyimpan tenaga untuk perkara yang benar-benar penting.
- **化身逻辑:** 贝果不装饰自己:扎实、耐嚼、越嚼越有味。第一眼平淡,处久了上瘾。
- **专属搭配:** Iced Pour-Over + Original Egg Tart(冰手冲 + 原味蛋挞)
- **认领句:** 「我不是高冷,我是省电模式。」
- **插画 brief:** 戴细框眼镜的原味贝果独坐窗边,手边一杯冰手冲,眼神清亮,窗外街景虚化。

### ILBT 全麦军师 · The Wholegrain Strategist · Jurutaktik Mil Penuh

- **画像 zh:** 朋友吵起来,大家先看你。你不劝架,只把事情摊开说清。你是人群里那片全麦:不花哨,但谁都离不开你。
- **en:** When friends clash, everyone looks at you first. You don't play referee—you just lay things out straight. You're the wholegrain of the group: nothing fancy, quietly essential.
- **ms:** Bila kawan bertelagah, semua pandang anda dulu. Anda tak jadi pengadil—anda cuma susun perkara sampai jelas. Andalah roti mil penuh kumpulan itu: tak bergaya, tapi semua perlukan anda.
- **化身逻辑:** 全麦面包:不打扮、不讨好,营养都在里面。可靠本身就是魅力。
- **专属搭配:** Iced Pour-Over + Pistachio Nut Bar(冰手冲 + 开心果坚果棒)
- **认领句:** 「讲道理我是专业的,听八卦我也在场。」
- **插画 brief:** 全麦吐司片系着小领巾坐在长桌中央摊开双手,左右各一只情绪激动的小面包,桌上摊着一张「事情经过」清单。

### ILDA 千层牛角 · The Layered Croissant · Croissant Berlapis

- **画像 zh:** 你需要一小时不属于任何人。手机反扣,窗边坐好——你的温柔分很多层,最里面那一层,只留给自己。
- **en:** You need one hour that belongs to no one. Phone face-down, window seat claimed—your softness comes in layers, and the innermost one is yours alone.
- **ms:** Anda perlukan satu jam yang bukan milik sesiapa. Telefon diterbalikkan, tempat tepi tingkap dituntut—kelembutan anda berlapis-lapis, dan lapisan paling dalam itu milik anda sendiri.
- **化身逻辑:** 牛角包的千层:一层一层都是黄油心思,轻轻一碰就掉屑——独处时间就是它的黄油。
- **专属搭配:** Iced Latte + Blueberry Cream Puff(冰拿铁 + 蓝莓泡芙)
- **认领句:** 「我的独处,一层一层都是黄油。」
- **插画 brief:** 牛角包戴耳机靠窗,午后阳光把酥皮照得发亮,桌上冰拿铁挂着水珠,手机屏幕朝下。

### ILDT 野餐佛卡夏 · The Picnic Focaccia · Focaccia Piknik

- **画像 zh:** 群里那句「出来坐坐?」通常是你发的。天气好、东西甜、人到齐,你的快乐就这么简单——撕一块,人人有份。
- **en:** The "shall we go out?" text usually comes from you. Good weather, something sweet, everyone present—that's your whole recipe for joy. Tear a piece; there's enough for all.
- **ms:** Mesej "jom keluar?" selalunya datang daripada anda. Cuaca elok, ada yang manis, semua orang cukup—itulah resipi kebahagiaan anda. Koyak sekeping; semua orang dapat.
- **化身逻辑:** 佛卡夏是「撕着分」的面包:平摊、大方、自带野餐属性。发起聚会的人,本身就是那块垫底的面包。
- **专属搭配:** Iced Latte + Macaron(冰拿铁 + 马卡龙)
- **认领句:** 「快乐要撕开分,才算数。」
- **插画 brief:** 插着小三角旗的佛卡夏躺在野餐垫中央,一圈小面包围坐,头顶两朵慢悠悠的云。

### ISBA 深夜黑麦 · The Midnight Rye · Rai Tengah Malam

- **画像 zh:** 你不需要安慰,只需要清醒。一杯不说话的冰美式,一张没人打扰的桌子,你就能把今晚该赢的仗打完。
- **en:** You don't need comforting—you need clarity. One iced Americano that asks no questions, one table nobody touches, and you'll win whatever tonight demands.
- **ms:** Anda tak perlukan pujukan—anda perlukan kejernihan. Satu Americano ais yang tak banyak tanya, satu meja tanpa gangguan, dan anda akan menang apa sahaja malam ini.
- **化身逻辑:** 黑麦面包:颜色深、质地实、能量足,不哄人但顶饿——深夜赶稿人的完美同类。
- **专属搭配:** Iced Americano + Original Egg Tart(冰美式 + 原味蛋挞)
- **认领句:** 「我沉默,是因为在输出。」
- **插画 brief:** 黑麦面包在台灯下敲笔记本电脑,屏幕光映在脸上,旁边冰美式,窗外深蓝夜色只剩一颗星。

### ISBT 碱水战友 · The Pretzel Comrade · Pretzel Seperjuangan

- **画像 zh:** 你不擅长寒暄,擅长把事情推完。像碱水结:看着拧,其实每个结都打得又稳又准——扛压这块,你是专业的。
- **en:** Small talk isn't your sport; finishing things is. Like a pretzel—looks twisted, but every knot is tied firm and true. Under pressure, you're the professional.
- **ms:** Berbasa-basi bukan bidang anda; menyiapkan kerja itu baru bidang anda. Macam pretzel—nampak berpintal, tapi setiap simpulannya kemas dan kukuh. Soal tahan tekanan, andalah pakarnya.
- **化身逻辑:** 碱水结的「结」不是乱,是结构——高温烤验出来的秩序感。战友型人格的形状。
- **专属搭配:** Iced Americano + Wellington(冰美式 + 惠灵顿)
- **认领句:** 「少说话,多交付。」
- **插画 brief:** 碱水结戴着护目镜推进度条(99%),桌上四杯冰美式在冒汗,没有人说话但气氛默契。

### ISDA 反差咖啡包 · The Coffee Bun Paradox · Roti Kopi Manis Rahsia

- **画像 zh:** 表面冷萃,内心黄油。你外表利落,兜里却总揣着一点甜——不解释。反差不是矛盾,是你留给自己的余地。
- **en:** Cold brew on the surface, butter at the core. You move sharp and travel light, yet always keep something sweet in your pocket—no explanations. Contrast isn't contradiction; it's the room you save for yourself.
- **ms:** Kopi pekat di luaran, mentega di dalaman. Anda nampak tangkas dan kemas, tapi dalam poket sentiasa ada sedikit manis—tanpa penjelasan. Kontras bukan konflik; ia ruang yang anda simpan untuk diri sendiri.
- **化身逻辑:** 墨西哥咖啡包(Roti Boy 式):苦香咖啡脆壳 + 化开的黄油心——马来西亚人最熟悉的「外冷内软」。本土梗,认领率会最高。
- **专属搭配:** Iced Americano + Chocolate Egg Tart(冰美式 + 巧克力蛋挞)
- **认领句:** 「苦是人设,甜是本体。」
- **插画 brief:** 咖啡色脆纹圆包戴墨镜,外套拉链拉开一半,露出金黄色发光的黄油内心。

### ISDT 派对甜甜圈 · The Party Donut · Donat Parti

- **画像 zh:** 散场太早是你最怕的事。又浓又甜的一杯下去,你还能再撑两小时——热闹这件事,总得有人负责到底。
- **en:** Ending early is your one fear. One strong, sweet cup and you're good for two more hours—someone has to be in charge of keeping the night alive, and it's you.
- **ms:** Bersurai awal ialah satu-satunya perkara yang anda takut. Satu minuman pekat dan manis, anda boleh bertahan dua jam lagi—mesti ada orang yang menjaga kemeriahan sampai habis, dan orangnya anda.
- **化身逻辑:** 甜甜圈是圆的:没有可以散场的角。彩针、糖霜、永动机式的快乐。
- **专属搭配:** Iced Americano + Macaron Platter(冰美式 + 马卡龙拼盘)
- **认领句:** 「圆的意义,就是没有散场的角。」
- **插画 brief:** 撒满彩针的甜甜圈举着仙女棒,身后一串小面包排成康加舞队,灯串亮着。

### HLBA 晨间酸种 · The Sourdough Ritualist · Sourdough Ritual Pagi

- **画像 zh:** 你的一天从一段没人打扰的清晨开始。像酸种一样慢慢发酵,不赶时间——你早就明白,好东西都需要等。
- **en:** Your day begins with a stretch of morning nobody touches. Like sourdough, you rise slowly and refuse to be rushed—you learned long ago that good things take their time.
- **ms:** Hari anda bermula dengan pagi yang tiada siapa ganggu. Macam sourdough, anda naik perlahan dan enggan diburu—anda dah lama faham, benda yang baik memang ambil masa.
- **化身逻辑:** 酸种:老面、慢发酵、每天同一时间进炉。仪式感不是讲究,是节律。
- **专属搭配:** Hot Pour-Over + Original Egg Tart(热手冲 + 原味蛋挞)
- **认领句:** 「我不是起得早,是舍不得清晨。」
- **插画 brief:** 乡村酸种面包在晨光里舒展做拉伸,旁边热手冲升起一条笔直的白气,卷帘门拉起一半。

### HLBT 长谈司康 · The Long-Talk Scone · Skon Teman Bicara

- **画像 zh:** 你能陪人聊三个小时,不急着给答案。杯凉了续,话散了捡——你在,事情就没那么难。
- **en:** You can sit with someone's story for three hours without rushing to fix it. Refill the cup when it cools, pick the thread back up when it drifts—things feel lighter simply because you're there.
- **ms:** Anda boleh menemani cerita seseorang tiga jam tanpa tergesa-gesa membetulkannya. Cawan sejuk, dituang semula; topik hanyut, dikutip kembali—segalanya terasa ringan semata-mata kerana anda ada.
- **化身逻辑:** 司康为下午茶而生:必须配一壶慢慢喝的茶、一段慢慢说的话。陪聊界的原生面包。
- **专属搭配:** Hot Pour-Over + Pistachio Nut Bar(热手冲 + 开心果坚果棒)
- **认领句:** 「我的特长:把『没事』听成『有事』。」
- **插画 brief:** 司康推一杯热茶给对面哭花脸的小可颂,桌上一盘叠好的纸巾,灯光是黄昏色。

### HLDA 暖房生吐司 · The Shokupan Nest · Sarang Roti Susu

- **画像 zh:** 你很会照顾自己:热的、甜的、软的,坐在暖的地方。这是你给自己盖的小房子——不对外开放,谢绝参观。
- **en:** You're good at looking after yourself: something hot, something sweet, something soft, in the warmest seat. It's a little house you built for one—not open to visitors.
- **ms:** Anda pandai menjaga diri: yang panas, yang manis, yang lembut, di tempat paling hangat. Itu rumah kecil yang anda bina untuk seorang—tidak dibuka untuk pelawat.
- **化身逻辑:** 生吐司:云朵质地、奶香、自带被窝感。一个人的暖房,枕头就是墙。
- **专属搭配:** Hot Latte + Blueberry Cream Puff(热拿铁 + 蓝莓泡芙)
- **认领句:** 「我自己,就是我的避风面包房。」
- **插画 brief:** 生吐司裹着奶白色毛毯窝在单人沙发,双手捧热拿铁,窗外下雨,屋里一盏小暖灯。

### HLDT 下午茶玛德琳 · The Madeleine Host · Madeleine Tuan Rumah

- **画像 zh:** 谁不吃坚果、谁要少糖、谁必须热的——你全记得。大家愿意来,一半为了茶点,一半为了你。
- **en:** Who skips nuts, who wants less sugar, who only drinks it hot—you remember it all. People keep coming back: half for the pastries, half for you.
- **ms:** Siapa tak makan kacang, siapa mahu kurang gula, siapa mesti minum panas—semuanya anda ingat. Orang datang lagi dan lagi: separuh kerana kuih, separuh kerana anda.
- **化身逻辑:** 玛德琳=记忆的甜点(普鲁斯特那一口)。记得每个人的口味,就是这一型的天赋。
- **专属搭配:** Hot Latte + Macaron(热拿铁 + 马卡龙)
- **认领句:** 「我的记性,只用来记你们。」
- **插画 brief:** 贝壳纹玛德琳系着小围裙布置长桌,每只杯子旁立着一张手写名牌,椅子摆得整整齐齐。

### HSBA 硬核法棍 · The Baguette Purist · Baguette Tulen

- **画像 zh:** 面粉、水、盐,三样就够——你对「好」有标准,而且不打算降。不为合群点头。这不是挑剔,是尊重。
- **en:** Flour, water, salt—three things done right are enough. You hold a standard for "good" and don't plan to lower it, not even to fit in. That's not being difficult. That's respect.
- **ms:** Tepung, air, garam—tiga bahan yang betul sudah memadai. Anda ada piawai untuk "yang baik" dan tak berniat menurunkannya, walau untuk menyenangkan sesiapa. Itu bukan cerewet. Itu hormat.
- **化身逻辑:** 法棍:配料表最短,标准最高。极简即立场。
- **专属搭配:** Hot Americano + Basque Cheesecake(热美式 + 巴斯克)
- **认领句:** 「我不难搞,我只是不将就。」
- **插画 brief:** 法棍抱臂而立,下巴微抬,面前一排原封未动的糖包,背景是干净的操作台。

### HSBT 深夜巴斯克 · The Midnight Basque · Basque Larut Malam

- **画像 zh:** 白天话不多,越夜越真心。烤焦的外壳底下全是软的——打烊前那句「其实我一直想说」,你只留给信得过的人。
- **en:** Quiet by day, honest after dark. Under the burnt shell it's all softness—and that "actually, I've been meaning to tell you…" in the last half-hour before closing is saved for the few you trust.
- **ms:** Pendiam pada siang hari, paling jujur selepas gelap. Di bawah kulit rentung itu semuanya lembut—dan ayat "sebenarnya, dah lama saya nak cakap…" pada setengah jam terakhir sebelum kedai tutup, hanya untuk orang yang anda percaya.
- **化身逻辑:** 巴斯克的灵魂就是那层焦壳:看着烧过头,切开全是流心。本店在售,认领即点单。
- **专属搭配:** Hot Americano + Wellington(热美式 + 惠灵顿)
- **认领句:** 「焦的是壳,软的是心。」
- **插画 brief:** 巴斯克蛋糕与一只小蛋挞在暖黄灯下对坐,两杯热美式冒着细烟,窗外是打烊后的街。

### HSDA 开心果蛋挞 · The Pistachio Tart · Tat Pistachio

- **画像 zh:** 苦你受得住,甜你不推辞。像开心果:壳有果仁的苦香,心是奶油的甜——日子从不非黑即白,你早就懂了。
- **en:** You can hold the bitter and still welcome the sweet. Like a pistachio: nutty edge on the shell, cream at the heart—life was never black and white, and you've known it for years.
- **ms:** Pahit anda tahan, manis anda tak tolak. Macam pistachio: kulitnya berbau kacang yang pahit-wangi, hatinya krim yang manis—hidup tak pernah hitam-putih, dan anda dah lama faham.
- **化身逻辑:** 开心果蛋挞是本店招牌(会员礼「Pistachio Green Jewel」同源)——把「甜苦兼修」这一型留给镇店之宝,测到这型的人天然成为品牌嘴替。
- **专属搭配:** Hot Americano + Pistachio Egg Tart(热美式 + 开心果蛋挞)
- **认领句:** 「一半清醒,一半柔软。」
- **插画 brief:** 淡绿色开心果蛋挞坐在摊开的笔记本前,左手边热美式,右手边一支笔,神情安静笃定。

### HSDT 生日蛋糕主理人 · The Cake Person · Ketua Kek Hari Jadi

- **画像 zh:** 谁的生日你都记得,蛋糕永远你订。蜡烛点亮那刻,你比寿星还开心——你相信高兴这件事,值得认真对待。
- **en:** You remember every birthday, and somehow the cake is always yours to order. The second the candles catch, you're happier than the birthday kid—because you believe joy deserves to be taken seriously.
- **ms:** Anda ingat setiap hari jadi, dan entah bagaimana kek sentiasa anda yang tempah. Saat lilin menyala, anda lebih gembira daripada orang yang diraikan—kerana anda percaya kegembiraan patut diambil serius.
- **化身逻辑:** 草莓鲜奶油蛋糕:庆祝的化身。这一型的天职是让别人的日子有仪式感。
- **专属搭配:** Hot Latte + 4-Inch Basque Cheesecake(热拿铁 + 4 吋巴斯克)
- **认领句:** 「仪式感不矫情,那是我爱你的单位。」
- **插画 brief:** 草莓奶油蛋糕双手捧着插满蜡烛的小蛋糕,烛光映亮一圈面包朋友的笑脸,彩带落下。

---

**插画统一风格 brief(16 张一套):**
拟人面包,圆润简笔,奶油质感上色;背景使用品牌色(蜜桃粉底 × 奶油纸 × 酒红点缀);每张一个道具、一个场景、一种情绪,构图统一为 1:1,便于拼成「十六宫格全家福」。全家福本身就是传播素材——**转发一张图,@出所有朋友对号入座**,这是 MBTI 十六宫格 meme 的标准玩法。

---

## 六、界面文案逐条替换表

> 表内为需要改动的 key;未列出的 key(验证码、错误、隐私等功能性文案)**保持不变**——隐私与合规文案语义不可动。`authTitle`「Freshly made. Unmistakably you.」被 e2e 钉住且质量过硬,**保留**。

| key | 现文案(zh) | 新文案 zh | 新文案 en | 新文案 ms |
|---|---|---|---|---|
| `introTitle` | 你是哪一种咖啡人? | 你是货架上的哪一块? | Which bread on our shelf is you? | Anda roti yang mana di rak kami? |
| `introBody` | 这里没有正确答案,只有最像你的那杯咖啡… | 16 种面包性格,每天新鲜出炉。几个小问题,认领那块和你同名的。 | Sixteen bread personalities, baked fresh every morning. A few small questions to claim the one with your name on it. | Enam belas personaliti roti, dibakar segar setiap pagi. Beberapa soalan kecil untuk menuntut yang tertulis nama anda. |
| `introTime` | 6 个选择 · 大约 40 秒 | 13 个小选择 · 大约 90 秒(六题版:6 个小选择 · 大约 40 秒) | 13 little choices · about 90 seconds | 13 pilihan kecil · kira-kira 90 saat |
| `introReward` | 完成后,会员礼物券会直接进入你的账户。 | 顺便说一句:出炉之后,柜台有一份小心意等你。 | P.S. There's a little something waiting at the counter once yours is out of the oven. | P.S. Ada sedikit buah tangan menanti di kaunter selepas roti anda keluar ketuhar. |
| `begin` | 进入 HBTI 测试 | 认领我的面包 | Claim my bread | Tuntut roti saya |
| `resume` | 继续上次的进度 | 面团还醒着,接着来 | The dough's still proofing—continue | Doh masih menunggu—sambung |
| `chooseOne` | 选择第一感觉最像你的答案。 | 凭第一感觉选。面团醒过头,就不松软了。 | Go with your first instinct—overproofed dough goes flat. | Ikut naluri pertama—doh yang terlebih menunggu akan kempis. |
| `questionProgress` | 第 x / y 题 | 第 x / y 题(不变) | Choice x of y(不变) | (不变) |
| `resultEyebrow` | 新鲜出炉 · 你的 HBTI | 刚出炉 · 你的 HBTI | Fresh from the oven · Your HBTI | Baru keluar ketuhar · HBTI anda |
| `resultTitle` | 这很像你。 | 刚出炉的,是你。 | Fresh out of the oven: you. | Baru keluar dari ketuhar: anda. |
| `signatureLabel` | 你的专属搭配 | 你的专属搭配(不变) | Your table order(不变) | (不变) |
| `retake` | 修改答案 | 重烤一次 | Bake it again | Bakar sekali lagi |
| `discoverGift` | 领取我的会员礼物 | 收下这份出炉礼 | Collect my fresh-out gift | Terima hadiah keluar ketuhar |
| `detailsEyebrow` | 最后一个小问题 | 最后一个小细节 | One last little detail(不变) | (不变) |
| `detailsTitle` | 选一个你第一眼会拿起的颜色。 | 选一个你第一眼会拿起的颜色。(不变) | (不变) | (不变) |
| `sendGift` | 完成我的 HBTI | 出炉! | Out of the oven! | Keluar ketuhar! |
| `sendingGift` | 正在放进你的账户… | 正在装袋… | Wrapping it up… | Sedang dibungkus… |
| `saveCard` | 保存我的人格卡 | 保存我的面包卡 | Save my bread card | Simpan kad roti saya |
| `shareCard` | 分享给朋友 | 给朋友也测一块 | Send a friend to the shelf | Ajak kawan pilih roti |
| `successEyebrow` | 新鲜出炉 · 留给下次见面的礼物 | 趁热 · 留给下次见面的礼物 | Still warm · For your next visit | Masih panas · Untuk kunjungan seterusnya |
| `demoModeBody` | 无需登录,即可体验完整 HBTI 流程。 | 先随便逛逛,不登录也能把 16 块面包看完。 | Browse freely—meet all sixteen breads without signing in. | Lihat-lihat dulu—jumpa semua enam belas roti tanpa log masuk. |
| `landingTitle` | 你的咖啡人格,可能比你更懂你。 | 你的面包性格,可能比你更懂你。 | Your bread personality might know you better than you do. | Personaliti roti anda mungkin lebih memahami anda. |
| `landingBody` | 六个小选择,看看你喜欢怎样喝… | 十几个小选择,看看你怎样发酵、怎样出炉、怎样被人记住。 | A dozen small choices reveal how you proof, how you bake, and how people remember you. | Belasan pilihan kecil mendedahkan cara anda menunggu, cara anda matang, dan cara orang mengingati anda. |
| `hbtiTypeLabel` | HBTI 人格类型 X | HBTI 面包性格 X | HBTI bread type X | Jenis roti HBTI X |

---

## 七、传播机制(文案层面就能做的)

1. **认领,不是测出。** 全流程用「认领/出炉」替代「测试/提交」——SBTI 的刷屏动作就叫「认领标签」。
2. **认领句 = 现成的朋友圈文案。** 每型一句,分享卡未来可直接印上(现阶段作为社媒物料使用)。
3. **十六宫格全家福。** 16 张插画拼一张图发出去,评论区自动开始「@你的碱水结朋友」。MBTI meme 的标准传播姿势,零开发成本。
4. **点单即认领。** 「深夜巴斯克」「开心果蛋挞」本身在售——测到的人到店点同款,是从线上到柜台的天然闭环(HSDA/HSBT 两型已内置)。
5. **店内联动(供参考):** 货架插牌写上 16 型名字与认领句,「你是哪一块?扫码认领」——把测试入口放回货架本身。

---

## 八、落地映射与边界

**照抄即可(零代码):**

| 内容 | 文件 · 字段 |
|---|---|
| ★ 六题子集(题干+选项) | `src/content/questions.ts` → 各题 `prompt` / `options[].label`(id、value、emoji 不动) |
| 16 型名字/画像/搭配 | `src/content/results.ts` → 各 code 的 `name` / `description` / `signatureOrder`(搭配无改动) |
| 8 个轴标签 | `src/content/results.ts` → `traitLabels` |
| 界面文案 | `src/content/ui.ts` → 第六节表内 key |

**需要少量代码(本方案不做,仅标注):**

- 13 题完整版:`types.ts` 增加 4 个答案字段、`questions.ts` 增题、`scoring.ts` 改为每轴三票多数决(逻辑一句话:`票数(H) ≥ 2 → H`)。
- 认领句进入分享卡:`result-card.ts` 增加一行绘制。
- 插画进入结果页/卡片:新增资源与渲染。

**改文案会碰到的测试(实施时同步更新,属代码改动范畴):**

- `tests/e2e/hbti.spec.ts`:断言了部分标题文本与三语内容;
- `tests/frontend-flow.test.tsx`:断言了 `HSDT`/`The Cake Person` 等结果名;
- `tests/content-completeness.test.ts`:校验三语字段齐全(本方案三语齐全,天然通过)。

**版式约束(为保住「每屏一页、无需滚动」):**
题干 zh ≤ 18 字 / en ≤ 60 字符;选项 zh ≤ 14 字;结果名 zh ≤ 7 字 / en ≤ 24 字符;画像 zh ≤ 75 字。本方案全部文案已按此上限写就,可直接替换不回流。

---

## 附:调研来源

- [MBTI 人格测试热背后:青年心态与社会结构调适 · 人民论坛](https://www.rmlt.com.cn/2024/0401/699212.shtml)
- [MBTI 测试成年轻人社交货币 · 凤凰网](https://gs.ifeng.com/c/8ss6CVhjZ2Z)
- [社交货币视角下 MBTI 在青年社交中的传播研究 · 参考网](https://m.fx361.com/news/2024/0821/24696422.html)
- [火遍全网的 MBTI 人格测试,为什么会有那么多人相信? · 知乎](https://zhuanlan.zhihu.com/p/500696927)
- [SBTI 测试 · 百度百科(2026-04-09 发布的戏仿版人格测试)](https://baike.baidu.com/item/SBTI%E6%B5%8B%E8%AF%95/67598800)
- [SBTI 全网爆火,你去认领人格标签了么? · 中国江苏网](https://jsnews.jschina.com.cn/jsyw/202604/t20260410_s69d8f09be4b0639de44f5a0b.shtml)
- [SBTI 人格是啥?为什么这么火? · 知乎](https://zhuanlan.zhihu.com/p/2025913450363101825)
- [SBTI 测试火了,它为什么能火? · 知乎问题](https://www.zhihu.com/question/2025672813621637606)
