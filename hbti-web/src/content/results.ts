import type {
  HbtiAxis,
  HbtiCode,
  HbtiResultContent,
  Locale,
  Localized,
  ResultTraits,
  SocialAxis,
  StrengthAxis,
  SweetnessAxis,
  TemperatureAxis,
} from "@/content/types";

export const hbtiCodes = [
  "ILBA",
  "ILBT",
  "ILDA",
  "ILDT",
  "ISBA",
  "ISBT",
  "ISDA",
  "ISDT",
  "HLBA",
  "HLBT",
  "HLDA",
  "HLDT",
  "HSBA",
  "HSBT",
  "HSDA",
  "HSDT",
] as const satisfies readonly HbtiCode[];

const traitLabels: Record<Locale, Record<HbtiAxis, string>> = {
  en: {
    I: "Iced",
    H: "Warm",
    L: "Light",
    S: "Strong",
    B: "Bittersweet",
    D: "Sweet",
    A: "Solo",
    T: "In-sync",
  },
  "zh-CN": {
    I: "冰系",
    H: "暖系",
    L: "轻盈",
    S: "浓烈",
    B: "回甘",
    D: "偏甜",
    A: "独享",
    T: "同频",
  },
  "ms-MY": {
    I: "Ais",
    H: "Hangat",
    L: "Ringan",
    S: "Pekat",
    B: "Pahit-manis",
    D: "Manis",
    A: "Bersendiri",
    T: "Sefrekuensi",
  },
};

interface ResultCopy {
  name: string;
  description: string;
  signatureOrder: string;
}

function traitsFor(code: HbtiCode, locale: Locale): ResultTraits {
  const [temperature, strength, sweetness, social] = code as unknown as [
    TemperatureAxis,
    StrengthAxis,
    SweetnessAxis,
    SocialAxis,
  ];

  return [
    traitLabels[locale][temperature],
    traitLabels[locale][strength],
    traitLabels[locale][sweetness],
    traitLabels[locale][social],
  ];
}

function localizedResult(
  code: HbtiCode,
  en: ResultCopy,
  zh: ResultCopy,
  ms: ResultCopy,
): Localized<HbtiResultContent> {
  return {
    en: { ...en, traits: traitsFor(code, "en") },
    "zh-CN": { ...zh, traits: traitsFor(code, "zh-CN") },
    "ms-MY": { ...ms, traits: traitsFor(code, "ms-MY") },
  };
}

export const results = {
  ILBA: localizedResult(
    "ILBA",
    {
      name: "The Clear-Eyed Bagel",
      description:
        "You're rarely the first to speak, but you see everything. No sugar, no fuss—your calm isn't coldness. It's saving your strength for what actually matters.",
      signatureOrder: "Kyoto Matcha + French Cocoa Crispy Pretzel",
    },
    {
      name: "清醒贝果",
      description:
        "你很少最先开口，但什么都看见了。不加糖、不凑热闹，你的冷静不是冷漠——是把力气留给真正重要的事。",
      signatureOrder: "京都冰抹茶 + 法式黑巧薄脆碱水结",
    },
    {
      name: "Bagel Mata Jernih",
      description:
        "Anda jarang bersuara dulu, tapi semuanya anda nampak. Tanpa gula, tanpa gimik—ketenangan anda bukan dingin, cuma menyimpan tenaga untuk perkara yang benar-benar penting.",
      signatureOrder: "Kyoto Matcha Ais + Pretzel Koko Rangup",
    },
  ),
  ILBT: localizedResult(
    "ILBT",
    {
      name: "The Wholegrain Strategist",
      description:
        "When friends clash, everyone looks at you first. You don't play referee—you just lay things out straight. You're the wholegrain of the group: nothing fancy, quietly essential.",
      signatureOrder: "Mocha Cold Brew + French Iranian Pistachio Walnut Macaron",
    },
    {
      name: "全麦军师",
      description:
        "朋友吵起来，大家先看你。你不劝架，只把事情摊开说清。你是人群里那片全麦：不花哨，但谁都离不开你。",
      signatureOrder: "抹茶冷萃 + 伊朗开心果核桃马卡龙",
    },
    {
      name: "Jurutaktik Mil Penuh",
      description:
        "Bila kawan bertelagah, semua pandang anda dulu. Anda tak jadi pengadil—anda cuma susun perkara sampai jelas. Andalah roti mil penuh kumpulan itu: tak bergaya, tapi semua perlukan anda.",
      signatureOrder: "Mocha Cold Brew + Macaron Pistachio Iran & Walnut",
    },
  ),
  ILDA: localizedResult(
    "ILDA",
    {
      name: "The Layered Croissant",
      description:
        "You need one hour that belongs to no one. Phone face-down, window seat claimed—your softness comes in layers, and the innermost one is yours alone.",
      signatureOrder: "Strawberry Cold Brew + French Strawberry Cream Tart",
    },
    {
      name: "千层牛角",
      description:
        "你需要一小时不属于任何人。手机反扣，窗边坐好——你的温柔分很多层，最里面那一层，只留给自己。",
      signatureOrder: "草莓冷萃 + 法式心动草莓奶油挞",
    },
    {
      name: "Croissant Berlapis",
      description:
        "Anda perlukan satu jam yang bukan milik sesiapa. Telefon diterbalikkan, tempat tepi tingkap dituntut—kelembutan anda berlapis-lapis, dan lapisan paling dalam itu milik anda sendiri.",
      signatureOrder: "Cold Brew Strawberi + Tat Krim Strawberi",
    },
  ),
  ILDT: localizedResult(
    "ILDT",
    {
      name: "The Picnic Focaccia",
      description:
        "The \"shall we go out?\" text usually comes from you. Good weather, something sweet, everyone present—that's your whole recipe for joy. Tear a piece; there's enough for all.",
      signatureOrder: "Pink Tango + Hot Crush Cheese Walnut Macaron",
    },
    {
      name: "野餐佛卡夏",
      description:
        "群里那句「出来坐坐？」通常是你发的。天气好、东西甜、人到齐，你的快乐就这么简单——撕一块，人人有份。",
      signatureOrder: "手打粉红芭乐柠檬茶 + 奶酪核桃马卡龙",
    },
    {
      name: "Focaccia Piknik",
      description:
        "Mesej \"jom keluar?\" selalunya datang daripada anda. Cuaca elok, ada yang manis, semua orang cukup—itulah resipi kebahagiaan anda. Koyak sekeping; semua orang dapat.",
      signatureOrder: "Pink Tango + Macaron Keju Walnut",
    },
  ),
  ISBA: localizedResult(
    "ISBA",
    {
      name: "The Midnight Rye",
      description:
        "You don't need comforting—you need clarity. One iced Americano that asks no questions, one table nobody touches, and you'll win whatever tonight demands.",
      signatureOrder: "Iced Americano + Hot Crush Egg Tart",
    },
    {
      name: "深夜黑麦",
      description:
        "你不需要安慰，只需要清醒。一杯不说话的冰美式，一张没人打扰的桌子，你就能把今晚该赢的仗打完。",
      signatureOrder: "冰美式 + 趁热心动蛋挞",
    },
    {
      name: "Rai Tengah Malam",
      description:
        "Anda tak perlukan pujukan—anda perlukan kejernihan. Satu Americano ais yang tak banyak tanya, satu meja tanpa gangguan, dan anda akan menang apa sahaja malam ini.",
      signatureOrder: "Americano Ais + Tat Telur Hot Crush",
    },
  ),
  ISBT: localizedResult(
    "ISBT",
    {
      name: "The Pretzel Comrade",
      description:
        "Small talk isn't your sport; finishing things is. Like a pretzel—looks twisted, but every knot is tied firm and true. Under pressure, you're the professional.",
      signatureOrder: "Pistachio Cold Brew + Signature Black Truffle Wellington Steak Croissant",
    },
    {
      name: "碱水战友",
      description:
        "你不擅长寒暄，擅长把事情推完。像碱水结：看着拧，其实每个结都打得又稳又准——扛压这块，你是专业的。",
      signatureOrder: "开心果冷萃 + 招牌黑松露牛排惠灵顿",
    },
    {
      name: "Pretzel Seperjuangan",
      description:
        "Berbasa-basi bukan bidang anda; menyiapkan kerja itu baru bidang anda. Macam pretzel—nampak berpintal, tapi setiap simpulannya kemas dan kukuh. Soal tahan tekanan, andalah pakarnya.",
      signatureOrder: "Cold Brew Pistachio + Croissant Wellington Stik Truffle Hitam",
    },
  ),
  ISDA: localizedResult(
    "ISDA",
    {
      name: "The Coffee Bun Paradox",
      description:
        "Cold brew on the surface, butter at the core. You move sharp and travel light, yet always keep something sweet in your pocket—no explanations. Contrast isn't contradiction; it's the room you save for yourself.",
      signatureOrder: "Chocolate Cold Brew + French Chocolate Tart",
    },
    {
      name: "反差咖啡包",
      description:
        "表面冷萃，内心黄油。你外表利落，兜里却总揣着一点甜——不解释。反差不是矛盾，是你留给自己的余地。",
      signatureOrder: "巧克力冷萃 + 法式心动巧克力蛋挞",
    },
    {
      name: "Roti Kopi Manis Rahsia",
      description:
        "Kopi pekat di luaran, mentega di dalaman. Anda nampak tangkas dan kemas, tapi dalam poket sentiasa ada sedikit manis—tanpa penjelasan. Kontras bukan konflik; ia ruang yang anda simpan untuk diri sendiri.",
      signatureOrder: "Cold Brew Coklat + Tat Coklat",
    },
  ),
  ISDT: localizedResult(
    "ISDT",
    {
      name: "The Party Donut",
      description:
        "Ending early is your one fear. One strong, sweet cup and you're good for two more hours—someone has to be in charge of keeping the night alive, and it's you.",
      signatureOrder: "Beryl Splash + Hot Crush Strawberry Cream Cake Puff",
    },
    {
      name: "派对甜甜圈",
      description:
        "散场太早是你最怕的事。又浓又甜的一杯下去，你还能再撑两小时——热闹这件事，总得有人负责到底。",
      signatureOrder: "手打爆爽柠檬茶 + 心动草莓奶油爆浆泡芙",
    },
    {
      name: "Donat Parti",
      description:
        "Bersurai awal ialah satu-satunya perkara yang anda takut. Satu minuman pekat dan manis, anda boleh bertahan dua jam lagi—mesti ada orang yang menjaga kemeriahan sampai habis, dan orangnya anda.",
      signatureOrder: "Beryl Splash + Puff Kek Krim Strawberi",
    },
  ),
  HLBA: localizedResult(
    "HLBA",
    {
      name: "The Sourdough Ritualist",
      description:
        "Your day begins with a stretch of morning nobody touches. Like sourdough, you rise slowly and refuse to be rushed—you learned long ago that good things take their time.",
      signatureOrder: "Hot Latte + Light Sugar Iranian Pistachio Cream Chocolate Mille-Feuille",
    },
    {
      name: "晨间酸种",
      description:
        "你的一天从一段没人打扰的清晨开始。像酸种一样慢慢发酵，不赶时间——你早就明白，好东西都需要等。",
      signatureOrder: "热拿铁 + 轻糖伊朗开心果奶油巧克力拿破仑酥",
    },
    {
      name: "Sourdough Ritual Pagi",
      description:
        "Hari anda bermula dengan pagi yang tiada siapa ganggu. Macam sourdough, anda naik perlahan dan enggan diburu—anda dah lama faham, benda yang baik memang ambil masa.",
      signatureOrder: "Latte Panas + Mille-Feuille Krim Pistachio Iran & Coklat",
    },
  ),
  HLBT: localizedResult(
    "HLBT",
    {
      name: "The Long-Talk Scone",
      description:
        "You can sit with someone's story for three hours without rushing to fix it. Refill the cup when it cools, pick the thread back up when it drifts—things feel lighter simply because you're there.",
      signatureOrder: "Matcha Latte + French Iranian Pistachio Walnut Macaron",
    },
    {
      name: "长谈司康",
      description:
        "你能陪人聊三个小时，不急着给答案。杯凉了续，话散了捡——你在，事情就没那么难。",
      signatureOrder: "京都抹茶拿铁 + 伊朗开心果核桃马卡龙",
    },
    {
      name: "Skon Teman Bicara",
      description:
        "Anda boleh menemani cerita seseorang tiga jam tanpa tergesa-gesa membetulkannya. Cawan sejuk, dituang semula; topik hanyut, dikutip kembali—segalanya terasa ringan semata-mata kerana anda ada.",
      signatureOrder: "Matcha Latte + Macaron Pistachio Iran & Walnut",
    },
  ),
  HLDA: localizedResult(
    "HLDA",
    {
      name: "The Shokupan Nest",
      description:
        "You're good at looking after yourself: something hot, something sweet, something soft, in the warmest seat. It's a little house you built for one—not open to visitors.",
      signatureOrder: "Rose Latte + French Blueberry Cream Tart",
    },
    {
      name: "暖房生吐司",
      description:
        "你很会照顾自己：热的、甜的、软的，坐在暖的地方。这是你给自己盖的小房子——不对外开放，谢绝参观。",
      signatureOrder: "趁热玫瑰拿铁 + 法式心动蓝莓奶油挞",
    },
    {
      name: "Sarang Roti Susu",
      description:
        "Anda pandai menjaga diri: yang panas, yang manis, yang lembut, di tempat paling hangat. Itu rumah kecil yang anda bina untuk seorang—tidak dibuka untuk pelawat.",
      signatureOrder: "Rose Latte + Tat Krim Bluberi",
    },
  ),
  HLDT: localizedResult(
    "HLDT",
    {
      name: "The Madeleine Host",
      description:
        "Who skips nuts, who wants less sugar, who only drinks it hot—you remember it all. People keep coming back: half for the pastries, half for you.",
      signatureOrder: "Hot Latte + Hot Crush Blueberry Cream Cake Puff",
    },
    {
      name: "下午茶玛德琳",
      description:
        "谁不吃坚果、谁要少糖、谁必须热的——你全记得。大家愿意来，一半为了茶点，一半为了你。",
      signatureOrder: "热拿铁 + 心动蓝莓奶油蛋糕泡芙",
    },
    {
      name: "Madeleine Tuan Rumah",
      description:
        "Siapa tak makan kacang, siapa mahu kurang gula, siapa mesti minum panas—semuanya anda ingat. Orang datang lagi dan lagi: separuh kerana kuih, separuh kerana anda.",
      signatureOrder: "Latte Panas + Puff Kek Krim Bluberi",
    },
  ),
  HSBA: localizedResult(
    "HSBA",
    {
      name: "The Baguette Purist",
      description:
        "Flour, water, salt—three things done right are enough. You hold a standard for \"good\" and don't plan to lower it, not even to fit in. That's not being difficult. That's respect.",
      signatureOrder: "Hot Americano + French Rich Dark Chocolate Hazelnut Macaron",
    },
    {
      name: "硬核法棍",
      description:
        "面粉、水、盐，三样就够——你对「好」有标准，而且不打算降。不为合群点头。这不是挑剔，是尊重。",
      signatureOrder: "热美式 + 榛子巧克力奶酪马卡龙",
    },
    {
      name: "Baguette Tulen",
      description:
        "Tepung, air, garam—tiga bahan yang betul sudah memadai. Anda ada piawai untuk \"yang baik\" dan tak berniat menurunkannya, walau untuk menyenangkan sesiapa. Itu bukan cerewet. Itu hormat.",
      signatureOrder: "Americano Panas + Macaron Coklat Gelap & Hazelnut",
    },
  ),
  HSBT: localizedResult(
    "HSBT",
    {
      name: "The Midnight Basque",
      description:
        "Quiet by day, honest after dark. Under the burnt shell it's all softness—and that \"actually, I've been meaning to tell you…\" in the last half-hour before closing is saved for the few you trust.",
      signatureOrder: "Thai Milk Tea Tiramisu + French Wild Blueberry Melty Basque",
    },
    {
      name: "深夜巴斯克",
      description:
        "白天话不多，越夜越真心。烤焦的外壳底下全是软的——打烊前那句「其实我一直想说」，你只留给信得过的人。",
      signatureOrder: "泰式鲜奶提拉米苏 + 蓝莓软心巴斯克",
    },
    {
      name: "Basque Larut Malam",
      description:
        "Pendiam pada siang hari, paling jujur selepas gelap. Di bawah kulit rentung itu semuanya lembut—dan ayat \"sebenarnya, dah lama saya nak cakap…\" pada setengah jam terakhir sebelum kedai tutup, hanya untuk orang yang anda percaya.",
      signatureOrder: "Thai Milk Tea Tiramisu + Basque Lembut Bluberi Liar",
    },
  ),
  HSDA: localizedResult(
    "HSDA",
    {
      name: "The Pistachio Tart",
      description:
        "You can hold the bitter and still welcome the sweet. Like a pistachio: nutty edge on the shell, cream at the heart—life was never black and white, and you've known it for years.",
      signatureOrder: "Thai Milk Latte + French Pistachio Tart",
    },
    {
      name: "开心果蛋挞",
      description:
        "苦你受得住，甜你不推辞。像开心果：壳有果仁的苦香，心是奶油的甜——日子从不非黑即白，你早就懂了。",
      signatureOrder: "趁热泰奶拿铁 + 法式心动开心果蛋挞",
    },
    {
      name: "Tat Pistachio",
      description:
        "Pahit anda tahan, manis anda tak tolak. Macam pistachio: kulitnya berbau kacang yang pahit-wangi, hatinya krim yang manis—hidup tak pernah hitam-putih, dan anda dah lama faham.",
      signatureOrder: "Thai Milk Latte + Tat Pistachio",
    },
  ),
  HSDT: localizedResult(
    "HSDT",
    {
      name: "The Cake Person",
      description:
        "You remember every birthday, and somehow the cake is always yours to order. The second the candles catch, you're happier than the birthday kid—because you believe joy deserves to be taken seriously.",
      signatureOrder: "Thai Milk Tea Tiramisu + French Chocolate Cream Cake Puff",
    },
    {
      name: "生日蛋糕主理人",
      description:
        "谁的生日你都记得，蛋糕永远你订。蜡烛点亮那刻，你比寿星还开心——你相信高兴这件事，值得认真对待。",
      signatureOrder: "泰式鲜奶提拉米苏 + 法式浓醇巧克力蛋糕泡芙",
    },
    {
      name: "Ketua Kek Hari Jadi",
      description:
        "Anda ingat setiap hari jadi, dan entah bagaimana kek sentiasa anda yang tempah. Saat lilin menyala, anda lebih gembira daripada orang yang diraikan—kerana anda percaya kegembiraan patut diambil serius.",
      signatureOrder: "Thai Milk Tea Tiramisu + Puff Kek Krim Coklat",
    },
  ),
} satisfies Record<HbtiCode, Localized<HbtiResultContent>>;
