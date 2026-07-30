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
    H: "Hot",
    L: "Light",
    S: "Strong",
    B: "Bitter",
    D: "Sweet",
    A: "Alone",
    T: "Together",
  },
  "zh-CN": {
    I: "冰饮",
    H: "热饮",
    L: "轻盈",
    S: "浓烈",
    B: "偏苦",
    D: "偏甜",
    A: "独享",
    T: "同行",
  },
  "ms-MY": {
    I: "Ais",
    H: "Panas",
    L: "Ringan",
    S: "Pekat",
    B: "Pahit",
    D: "Manis",
    A: "Sendiri",
    T: "Bersama",
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
      name: "The Clear-Eyed",
      description:
        "You rarely speak first, but you notice everything. You take your time with an iced pour-over, thoughts settling beside an empty chair no one is about to claim.",
      signatureOrder: "Iced Pour-Over + Original Egg Tart",
    },
    {
      name: "清醒观察者",
      description:
        "你很少是最先开口的那个，但你什么都看见了。一杯冰手冲放在手边，慢慢喝，慢慢想——你要的不是刺激，是一段没人打扰的清醒。",
      signatureOrder: "冰手冲 + 原味蛋挞",
    },
    {
      name: "Pemerhati Tajam",
      description:
        "Anda jarang jadi orang pertama yang bersuara, tapi semuanya anda perasan. Dengan kopi pour-over ais di sisi, anda minum dan berfikir perlahan-lahan—bukan kejutan yang dicari, cuma satu jam yang jernih tanpa gangguan.",
      signatureOrder: "Kopi Pour-Over Ais + Tat Telur Asli",
    },
  ),
  ILBT: localizedResult(
    "ILBT",
    {
      name: "The Level Head",
      description:
        "When friends start arguing, everyone looks your way. You lay out what matters over an iced pour-over until the voices drop and both hands settle back around their cold glasses.",
      signatureOrder: "Iced Pour-Over + Pistachio Nut Bar",
    },
    {
      name: "理性搭子",
      description:
        "朋友吵起来的时候，大家会先看你一眼。你不劝架，你只是把事情说清楚。一起坐下来，喝点不甜的、不烫的，然后事情就没那么大了。",
      signatureOrder: "冰手冲 + 开心果坚果棒",
    },
    {
      name: "Teman Kepala Dingin",
      description:
        "Bila kawan-kawan mula bertelagah, semua orang akan pandang anda dahulu. Anda bukan cuba jadi orang tengah; anda cuma meluruskan perkara yang berserabut. Duduk bersama dengan minuman yang tak manis dan tak panas, tiba-tiba masalah itu terasa lebih kecil.",
      signatureOrder: "Kopi Pour-Over Ais + Bar Kacang Pistachio",
    },
  ),
  ILDA: localizedResult(
    "ILDA",
    {
      name: "The Afternoon Escapist",
      description:
        "You slip away for an hour that belongs to no one else. An iced latte by the window, your phone face-down—the world can wait on the other side of the glass.",
      signatureOrder: "Iced Latte + Blueberry Cream Puff",
    },
    {
      name: "午后逃逸者",
      description:
        "你不是不想上班，你只是需要一小时不属于任何人。冰拿铁、靠窗的位置、手机反扣——这一小时结束之前，世界可以先等一等。",
      signatureOrder: "冰拿铁 + 蓝莓泡芙",
    },
    {
      name: "Pelarian Petang",
      description:
        "Bukan anda tak mahu bekerja; anda cuma perlukan satu jam yang bukan milik sesiapa. Latte ais, tempat di tepi tingkap, telefon diterbalikkan—dunia boleh tunggu sampai sejam itu habis.",
      signatureOrder: "Latte Ais + Puff Krim Blueberi",
    },
  ),
  ILDT: localizedResult(
    "ILDT",
    {
      name: "The Picnic Starter",
      description:
        "You send “shall we go somewhere?” to the group chat before anyone else does. Soon, something sweet sits in the middle of a picnic blanket with every friend finally gathered around it.",
      signatureOrder: "Iced Latte + Macaron",
    },
    {
      name: "野餐发起人",
      description:
        "群里那句「要不要出去坐坐」，通常是你发的。你不追求隆重，只要天气好、东西甜、人齐就够了。事情办不办得成不重要，重要的是大家都出来了。",
      signatureOrder: "冰拿铁 + 马卡龙",
    },
    {
      name: "Pencetus Piknik",
      description:
        "Mesej ajak “keluar duduk-duduk” dalam group chat selalunya datang daripada anda. Tak perlu gah; cuaca elok, ada yang manis, dan semua orang cukup. Jadi atau tak rancangan itu kurang penting—yang penting semua dah keluar.",
      signatureOrder: "Latte Ais + Makaron",
    },
  ),
  ISBA: localizedResult(
    "ISBA",
    {
      name: "The Deadline Runner",
      description:
        "You don’t ask for reassurance when a deadline closes in; you get moving. An iced Americano, a glowing laptop, and an empty chair beside you carry the room past midnight.",
      signatureOrder: "Iced Americano + Original Egg Tart",
    },
    {
      name: "深夜赶稿人",
      description:
        "你不需要被安慰，只需要被清醒。最好的陪伴是一杯不说话的冰美式，和一张没人坐过来的桌子。",
      signatureOrder: "冰美式 + 原味蛋挞",
    },
    {
      name: "Pejuang Deadline",
      description:
        "Anda tak perlukan pujukan bila deadline semakin dekat; anda terus bergerak. Teman terbaik ialah secawan Americano ais yang tak meminta apa-apa, sebuah komputer riba yang menyala, dan kerusi kosong di sebelah.",
      signatureOrder: "Americano Ais + Tat Telur Asli",
    },
  ),
  ISBT: localizedResult(
    "ISBT",
    {
      name: "The War Room Ally",
      description:
        "You skip the small talk and push the work across the line. Four iced Americanos sweat across the meeting table while the progress bar keeps moving in silence.",
      signatureOrder: "Iced Americano + Wellington",
    },
    {
      name: "会议室战友",
      description:
        "你不擅长寒暄，但你擅长把事情推完。桌上四杯冰美式，谁也没说话，进度条却在动——这种沉默你觉得很舒服。",
      signatureOrder: "冰美式 + 惠灵顿",
    },
    {
      name: "Sekutu Bilik Mesyuarat",
      description:
        "Anda kurang gemar berbasa-basi, tapi anda tahu cara menyiapkan kerja. Empat Americano ais berembun di atas meja; tiada siapa bercakap, namun bar kemajuan terus bergerak.",
      signatureOrder: "Americano Ais + Wellington",
    },
  ),
  ISDA: localizedResult(
    "ISDA",
    {
      name: "The Secret Sweet Tooth",
      description:
        "You move briskly through the day and keep your small indulgences to yourself. Then you set a chocolate egg tart beside a bitter iced Americano—one dark cup and one glossy tart under the café lights.",
      signatureOrder: "Iced Americano + Chocolate Egg Tart",
    },
    {
      name: "反差控",
      description:
        "外面看你很利落，其实你偷偷在咖啡里加了糖。你不解释，也不觉得需要解释——反差不是矛盾，是你留给自己的那点余地。",
      signatureOrder: "冰美式 + 巧克力蛋挞",
    },
    {
      name: "Peminat Manis Rahsia",
      description:
        "Dari luar, anda nampak serba pantas dan kemas; diam-diam, anda tetap mahu sedikit manis. Americano ais yang pahit duduk di sebelah tat telur coklat berkilat—ruang kecil yang anda simpan untuk diri sendiri.",
      signatureOrder: "Americano Ais + Tat Telur Coklat",
    },
  ),
  ISDT: localizedResult(
    "ISDT",
    {
      name: "The Night Extender",
      description:
        "You’re always the one asking everyone to stay a little longer. A strong iced Americano and a macaron platter keep the last few friends laughing under the lights long after they said they would leave.",
      signatureOrder: "Iced Americano + Macaron Platter",
    },
    {
      name: "派对续命师",
      description:
        "散场太早是你最怕的事。一杯又浓又甜的冰的，够你再撑两小时，也够你把已经想走的人留下来。热闹这件事，总要有人负责。",
      signatureOrder: "冰美式 + 马卡龙拼盘",
    },
    {
      name: "Penyambung Malam",
      description:
        "Anda selalu jadi orang yang minta semua tunggu sekejap lagi. Americano ais yang pekat dan sepiring makaron membuat kawan-kawan terakhir terus ketawa, lama selepas mereka kata mahu balik.",
      signatureOrder: "Americano Ais + Sepiring Makaron",
    },
  ),
  HLBA: localizedResult(
    "HLBA",
    {
      name: "The Morning Ritualist",
      description:
        "You guard the first quiet minutes of the morning. The same hot pour-over, the first sip untouched, and a familiar egg tart wait in their usual places as the shutters rise.",
      signatureOrder: "Hot Pour-Over + Original Egg Tart",
    },
    {
      name: "晨间仪式派",
      description:
        "一天里最好的那段在早上，而且不能被人分走。热手冲，第一口不加任何东西，喝完才算真正醒来。这个顺序你已经很多年没变过。",
      signatureOrder: "热手冲 + 原味蛋挞",
    },
    {
      name: "Pengamal Ritual Pagi",
      description:
        "Anda menjaga minit-minit sunyi pertama pada waktu pagi. Pour-over panas yang sama, teguk pertama tanpa apa-apa tambahan, dan tat telur di tempat biasa menunggu ketika bidai kedai mula dibuka.",
      signatureOrder: "Kopi Pour-Over Panas + Tat Telur Asli",
    },
  ),
  HLBT: localizedResult(
    "HLBT",
    {
      name: "The Long Talker",
      description:
        "You stay with someone’s story for hours without rushing to solve it. When the cup cools and the conversation wanders, you order another pour-over and pull the loose thread gently back across the table.",
      signatureOrder: "Hot Pour-Over + Pistachio Nut Bar",
    },
    {
      name: "长谈陪伴者",
      description:
        "你是那种能陪人聊三个小时的人。杯子凉了会续，话题散了会捡回来——你不急着给建议，你只是让对方知道你还在。",
      signatureOrder: "热手冲 + 开心果坚果棒",
    },
    {
      name: "Teman Berbual Panjang",
      description:
        "Anda boleh menemani cerita seseorang berjam-jam tanpa tergesa-gesa mahu membetulkannya. Bila cawan sejuk dan topik mula hanyut, anda pesan satu lagi pour-over lalu membawa perbualan kembali perlahan-lahan.",
      signatureOrder: "Kopi Pour-Over Panas + Bar Kacang Pistachio",
    },
  ),
  HLDA: localizedResult(
    "HLDA",
    {
      name: "The Warm Room Keeper",
      description:
        "You know when to make a little room for yourself. A warm latte, a soft blueberry puff, and a tucked-away table turn one café corner into a small room with the door quietly closed.",
      signatureOrder: "Hot Latte + Blueberry Cream Puff",
    },
    {
      name: "暖房独享家",
      description:
        "你很会照顾自己。一杯热的、甜的、不太浓的，配一块软的东西，坐在暖的地方——这是你给自己修的一间小房子，不对外开放。",
      signatureOrder: "热拿铁 + 蓝莓泡芙",
    },
    {
      name: "Penjaga Sudut Hangat",
      description:
        "Anda tahu bila perlu menyediakan sedikit ruang untuk diri sendiri. Latte panas, puff blueberi yang lembut, dan meja tersorok mengubah satu sudut kafe menjadi bilik kecil dengan pintunya tertutup senyap.",
      signatureOrder: "Latte Panas + Puff Krim Blueberi",
    },
  ),
  HLDT: localizedResult(
    "HLDT",
    {
      name: "The Tea Time Host",
      description:
        "You remember who skips nuts, who wants less sugar, and who always orders hot. By the time everyone arrives, the macarons are lined up, the lattes are steaming, and every seat around your table is saved.",
      signatureOrder: "Hot Latte + Macaron",
    },
    {
      name: "下午茶召集人",
      description:
        "你记得每个人的口味。谁不吃坚果、谁要少糖、谁一定要热的——点单的时候你从来不用问。大家愿意来，一半因为东西好吃，一半因为你在。",
      signatureOrder: "热拿铁 + 马卡龙",
    },
    {
      name: "Tuan Rumah Minum Petang",
      description:
        "Anda ingat siapa tak makan kacang, siapa mahu kurang gula, dan siapa mesti pesan panas. Bila semua tiba, makaron sudah tersusun, latte masih berwap, dan setiap tempat di meja anda sudah disimpan.",
      signatureOrder: "Latte Panas + Makaron",
    },
  ),
  HSBA: localizedResult(
    "HSBA",
    {
      name: "The Purist",
      description:
        "You taste carefully and never lower the bar just to be agreeable. Steam rises from a bold Americano beside a dense slice of Basque cheesecake, with every sugar packet left unopened.",
      signatureOrder: "Hot Americano + Basque Cheesecake",
    },
    {
      name: "硬核老饕",
      description:
        "你对「好吃」有标准，而且不打算降低。热的、浓的、不加糖的，配一块扎实的巴斯克——你不需要有人认同，你只需要它是对的。",
      signatureOrder: "热美式 + 巴斯克",
    },
    {
      name: "Pencinta Tulen",
      description:
        "Anda merasa dengan teliti dan tak pernah merendahkan standard hanya untuk menyenangkan orang. Wap naik daripada Americano yang pekat di sebelah sepotong kek keju Basque, sementara semua paket gula kekal tidak dibuka.",
      signatureOrder: "Americano Panas + Kek Keju Basque",
    },
  ),
  HSBT: localizedResult(
    "HSBT",
    {
      name: "The Late Night Confidant",
      description:
        "You keep quiet through the day, then let the real conversation begin after dark. Over a hot Americano, your soft “I’ve been meaning to tell you…” hangs between two chairs in the last half-hour before closing.",
      signatureOrder: "Hot Americano + Wellington",
    },
    {
      name: "深夜谈心局",
      description:
        "白天你话不多，越晚话越多。一杯浓的、热的，配一句「其实我一直想说」——真正重要的对话，都发生在打烊前那半小时。",
      signatureOrder: "热美式 + 惠灵顿",
    },
    {
      name: "Teman Bicara Larut Malam",
      description:
        "Anda banyak diam pada siang hari, kemudian perbualan sebenar bermula selepas gelap. Di hadapan Americano panas, ayat perlahan “sebenarnya, dah lama saya nak cakap…” tergantung antara dua kerusi dalam setengah jam sebelum kedai tutup.",
      signatureOrder: "Americano Panas + Wellington",
    },
  ),
  HSDA: localizedResult(
    "HSDA",
    {
      name: "The Both-And",
      description:
        "You take bitter and sweet as they come, without asking either one to disappear. You work the question through alone, with a hot Americano to the left of your notebook and a pistachio egg tart to the right.",
      signatureOrder: "Hot Americano + Pistachio Egg Tart",
    },
    {
      name: "甜苦兼修者",
      description:
        "苦你受得住，甜你也不推辞。你早就知道日子不是非黑即白的，所以一杯浓的配一块甜的，刚刚好。这道题你自己解，不用别人参与。",
      signatureOrder: "热美式 + 开心果蛋挞",
    },
    {
      name: "Pahit dan Manis",
      description:
        "Anda menerima pahit dan manis tanpa meminta salah satunya hilang. Soalan itu anda fikirkan sendiri, dengan Americano panas di kiri buku nota dan tat telur pistachio di kanan.",
      signatureOrder: "Americano Panas + Tat Telur Pistachio",
    },
  ),
  HSDT: localizedResult(
    "HSDT",
    {
      name: "The Cake Person",
      description:
        "You remember every birthday and somehow end up ordering the cake. When the candles catch above a four-inch Basque, you’re already smiling across the table before the birthday guest makes a wish.",
      signatureOrder: "Hot Latte + 4-Inch Basque Cheesecake",
    },
    {
      name: "生日蛋糕主理人",
      description:
        "谁过生日你都记得，蛋糕永远是你订的。你喜欢浓的、甜的、有仪式感的东西，因为你相信高兴这件事值得被认真对待。插上蜡烛那一刻，你比寿星还开心。",
      signatureOrder: "热拿铁 + 4 吋巴斯克",
    },
    {
      name: "Ketua Kek Hari Jadi",
      description:
        "Anda ingat setiap hari jadi dan entah bagaimana selalu jadi orang yang menempah kek. Bila lilin menyala di atas kek Basque empat inci, anda sudah tersenyum dari seberang meja sebelum orang yang diraikan sempat membuat hajat.",
      signatureOrder: "Latte Panas + Kek Keju Basque 4 Inci",
    },
  ),
} satisfies Record<HbtiCode, Localized<HbtiResultContent>>;
