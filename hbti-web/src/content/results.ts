import { defaultHbtiProductId, hbtiProductName, type HbtiProductId } from "@/content/products";
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
    en: {
      ...en,
      traits: traitsFor(code, "en"),
      signatureOrder: hbtiProductName(defaultHbtiProductId, "en"),
    },
    "zh-CN": {
      ...zh,
      traits: traitsFor(code, "zh-CN"),
      signatureOrder: hbtiProductName(defaultHbtiProductId, "zh-CN"),
    },
    "ms-MY": {
      ...ms,
      traits: traitsFor(code, "ms-MY"),
      signatureOrder: hbtiProductName(defaultHbtiProductId, "ms-MY"),
    },
  };
}

export const results = {
  ILBA: localizedResult(
    "ILBA",
    {
      name: "Clear-eyed Observer",
      description:
        "You notice the small things before anyone says a word. You take your time, keep your own rhythm and save your energy for what matters.",
    },
    {
      name: "清醒观察家",
      description:
        "你很少最先开口，却总能看见细节。不急着跟风，也不忙着表态，你把力气留给真正重要的事。",
    },
    {
      name: "Pemerhati Jernih",
      description:
        "Anda nampak butiran kecil sebelum sesiapa bersuara. Anda ikut rentak sendiri dan simpan tenaga untuk perkara yang penting.",
    },
  ),
  ILBT: localizedResult(
    "ILBT",
    {
      name: "Quiet Strategist",
      description:
        "When opinions clash, people look to you. You make the messy bits clear, then quietly help everyone move forward.",
    },
    {
      name: "稳场军师",
      description:
        "朋友各执一词时，大家总会先看你。你把事情捋清，再陪着大家往前走，靠谱藏在不声不响的照顾里。",
    },
    {
      name: "Perancang Tenang",
      description:
        "Bila pendapat bercanggah, semua memandang anda. Anda jelaskan perkara yang berserabut, kemudian bantu semua bergerak ke depan.",
    },
  ),
  ILDA: localizedResult(
    "ILDA",
    {
      name: "Gentle Dreamer",
      description:
        "You always leave a little room for daydreams. A window seat and an unhurried hour are enough to make the day feel like yours.",
    },
    {
      name: "柔软梦想家",
      description:
        "你总会给自己留一点发呆的空隙。靠窗坐好，慢慢享受，这一小段时间只属于你。",
    },
    {
      name: "Pemimpi Lembut",
      description:
        "Anda sentiasa beri ruang untuk berangan. Tempat di tepi tingkap dan masa tanpa tergesa-gesa sudah cukup untuk diri sendiri.",
    },
  ),
  ILDT: localizedResult(
    "ILDT",
    {
      name: "Joyful Connector",
      description:
        "You are usually the one who suggests getting together. Good company and a little surprise can turn an ordinary afternoon into a favourite memory.",
    },
    {
      name: "快乐召集人",
      description:
        "群里那句「出来坐坐？」通常是你发的。把喜欢的人聚到一起，再添一点小惊喜，平常的下午也能值得纪念。",
    },
    {
      name: "Pencetus Ceria",
      description:
        "Andalah yang selalu mengajak semua berkumpul. Teman yang baik dan sedikit kejutan boleh menjadikan petang biasa satu kenangan indah.",
    },
  ),
  ISBA: localizedResult(
    "ISBA",
    {
      name: "Night Navigator",
      description:
        "You think most clearly when the noise settles. Give yourself a quiet corner and a clear goal, and you will find the next step.",
    },
    {
      name: "深夜领航员",
      description:
        "周围安静下来，你反而更清醒。给自己一个不被打扰的角落，把目标想明白，接下来就交给行动。",
    },
    {
      name: "Pemandu Malam",
      description:
        "Fikiran anda paling jelas apabila suasana tenang. Dengan sudut yang sunyi dan matlamat yang jelas, anda tahu langkah seterusnya.",
    },
  ),
  ISBT: localizedResult(
    "ISBT",
    {
      name: "Steady Finisher",
      description:
        "You would rather get something done than talk about doing it. When things get busy, you steady the pace and make sure nothing is left unfinished.",
    },
    {
      name: "靠谱行动派",
      description:
        "你不爱空谈，喜欢把事情一件件做好。越是忙乱的时候，越能看见你的稳，答应的事总会放在心上。",
    },
    {
      name: "Pelaksana Teguh",
      description:
        "Anda lebih suka bertindak daripada sekadar bercakap. Bila keadaan sibuk, anda tenangkan rentak dan pastikan semuanya selesai.",
    },
  ),
  ISDA: localizedResult(
    "ISDA",
    {
      name: "Quiet Romantic",
      description:
        "You look decisive, but keep a soft spot for little surprises. Your practical side and your romantic side get along just fine.",
    },
    {
      name: "反差浪漫派",
      description:
        "你看起来利落干脆，却总会为小惊喜留个位置。认真做事，也认真喜欢，反差里藏着只有熟人知道的浪漫。",
    },
    {
      name: "Romantis Bersahaja",
      description:
        "Anda nampak tegas, tetapi tetap menyukai kejutan kecil. Sisi praktikal dan sisi romantik anda saling melengkapi.",
    },
  ),
  ISDT: localizedResult(
    "ISDT",
    {
      name: "Life of the Party",
      description:
        "You bring the extra spark that keeps everyone smiling. Another story, another laugh, and suddenly nobody is in a hurry to leave.",
    },
    {
      name: "气氛点火者",
      description:
        "有你在，气氛总能再热一点。多讲一个故事，多留一会儿，你喜欢让每个人都尽兴。",
    },
    {
      name: "Penyeri Suasana",
      description:
        "Anda membawa keceriaan yang membuat semua tersenyum. Satu lagi cerita, satu lagi gelak, dan tiada siapa mahu pulang dulu.",
    },
  ),
  HLBA: localizedResult(
    "HLBA",
    {
      name: "Ritual Keeper",
      description:
        "Small routines make your day feel right. You like a gentle start, a familiar place and enough time to enjoy the details.",
    },
    {
      name: "日常仪式家",
      description:
        "你喜欢用熟悉的小习惯，慢慢打开一天。把节奏放稳，把细节照顾好，平凡的日常也能过得很有滋味。",
    },
    {
      name: "Penjaga Rutin",
      description:
        "Rutin kecil membuat hari anda terasa lengkap. Anda suka permulaan yang tenang, tempat yang biasa dan masa untuk menikmati setiap butiran.",
    },
  ),
  HLBT: localizedResult(
    "HLBT",
    {
      name: "Patient Listener",
      description:
        "You let people finish their stories without rushing to find an answer. A patient pause and a well-timed question make you easy to talk to.",
    },
    {
      name: "耐心倾听者",
      description:
        "别人说话时，你愿意认真听完。一个恰好的停顿、一句接得住的话，就能让身边的人慢慢放松下来。",
    },
    {
      name: "Pendengar Setia",
      description:
        "Anda mendengar hingga selesai tanpa tergesa-gesa memberi jawapan. Kesabaran dan soalan yang tepat membuat orang selesa bercerita.",
    },
  ),
  HLDA: localizedResult(
    "HLDA",
    {
      name: "Cozy Homebody",
      description:
        "You know how to make a small moment comfortable. A favourite seat and some time to yourself can turn an ordinary break into a little retreat.",
    },
    {
      name: "温柔独享家",
      description:
        "你很会给自己安排一点舒服。挑个喜欢的位置，享受一小段独处，把普通的休息过成专属的小假期。",
    },
    {
      name: "Pencinta Nyaman",
      description:
        "Anda tahu menjadikan saat kecil lebih selesa. Tempat duduk kegemaran dan masa sendiri boleh terasa seperti percutian singkat.",
    },
  ),
  HLDT: localizedResult(
    "HLDT",
    {
      name: "Thoughtful Host",
      description:
        "You remember the little things that help others feel welcome. People feel cared for around you, often before they realise why.",
    },
    {
      name: "贴心照顾者",
      description:
        "谁喜欢什么、谁今天有点累，你常常都记得。你的贴心不用大张旗鼓，却总能让人觉得被好好照顾着。",
    },
    {
      name: "Tuan Rumah Prihatin",
      description:
        "Anda ingat perkara kecil yang membuat orang rasa dialu-alukan. Bersama anda, mereka rasa dijaga tanpa perlu meminta.",
    },
  ),
  HSBA: localizedResult(
    "HSBA",
    {
      name: "Principled Maker",
      description:
        "You know what good work looks like and take the time to do it properly. Details matter to you because care shows in the finished thing.",
    },
    {
      name: "认真坚持派",
      description:
        "你对喜欢的事有自己的标准，也愿意为细节多花一点心思。把事情认真做好，是你表达在意的方式。",
    },
    {
      name: "Pembuat Berprinsip",
      description:
        "Anda tahu hasil yang baik dan sanggup meluangkan masa untuknya. Bagi anda, setiap butiran menunjukkan kesungguhan.",
    },
  ),
  HSBT: localizedResult(
    "HSBT",
    {
      name: "After-hours Confidant",
      description:
        "You take a little time to open up, then give people your full attention. The stories you share are saved for those who have earned your trust.",
    },
    {
      name: "慢热知心人",
      description:
        "你熟起来需要一点时间，走近以后却很真诚。那些没对外说过的心事，你会留给真正信任的人。",
    },
    {
      name: "Sahabat Akrab",
      description:
        "Anda perlukan masa untuk membuka hati, kemudian memberi perhatian sepenuhnya. Cerita peribadi anda disimpan untuk orang yang benar-benar dipercayai.",
    },
  ),
  HSDA: localizedResult(
    "HSDA",
    {
      name: "Balanced Optimist",
      description:
        "You can see the complicated side of things and still find something to enjoy. You make room for different feelings without losing your curiosity.",
    },
    {
      name: "通透乐天派",
      description:
        "你看得见生活的复杂，也愿意发现其中的可爱。不急着把一切分成好坏，心里有分寸，眼里有期待。",
    },
    {
      name: "Optimis Seimbang",
      description:
        "Anda nampak kerumitan hidup tetapi tetap menemui kegembiraan. Anda menerima pelbagai perasaan tanpa kehilangan rasa ingin tahu.",
    },
  ),
  HSDT: localizedResult(
    "HSDT",
    {
      name: "Celebration Maker",
      description:
        "You remember the dates and little wins that deserve a celebration. You enjoy making a moment special, especially when someone else gets to feel loved.",
    },
    {
      name: "庆祝主理人",
      description:
        "你记得值得庆祝的日子，也不放过平常的小进步。准备一点惊喜，看见别人开心，你就觉得这份心思很值得。",
    },
    {
      name: "Pencipta Keraian",
      description:
        "Anda ingat tarikh dan kejayaan kecil yang patut diraikan. Anda suka menjadikan sesuatu saat istimewa supaya orang lain rasa disayangi.",
    },
  ),
} satisfies Record<HbtiCode, Localized<HbtiResultContent>>;

/** Keep the personality title separate from the matched product recommendation. */
export function getHbtiResult(
  code: HbtiCode,
  locale: Locale,
  productId?: HbtiProductId,
): HbtiResultContent {
  const personality = results[code][locale];
  if (!productId) return personality;
  const productName = hbtiProductName(productId, locale);
  return {
    ...personality,
    signatureOrder: productName,
  };
}
