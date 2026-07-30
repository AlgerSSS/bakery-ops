import type { HbtiQuestion } from "@/content/types";

export const questions = [
  {
    id: "q1",
    prompt: {
      en: "It’s Friday after work. You push open the door—what do you want first?",
      "zh-CN": "周五下班，你推开店门，第一秒想要的是——",
      "ms-MY":
        "Hari Jumaat selepas kerja, bila anda buka pintu kedai, apa yang paling anda teringin?",
    },
    options: [
      {
        value: "hot",
        emoji: "🔥",
        label: {
          en: "A cup still steaming in your hands",
          "zh-CN": "手里那杯还在冒烟的",
          "ms-MY": "Secawan panas yang masih berwap",
        },
      },
      {
        value: "iced",
        emoji: "🧊",
        label: {
          en: "Condensation beading on the glass",
          "zh-CN": "杯壁上那层冷汗",
          "ms-MY": "Titisan embun sejuk pada permukaan cawan",
        },
      },
    ],
  },
  {
    id: "q2",
    prompt: {
      en: "If coffee were a person, you’d want them to—",
      "zh-CN": "如果咖啡是一个人，你希望他——",
      "ms-MY": "Kalau kopi itu seseorang, anda mahu dia—",
    },
    options: [
      {
        value: "strong",
        emoji: "⚡",
        label: {
          en: "Wake you up with the first word",
          "zh-CN": "一开口就让你清醒",
          "ms-MY": "Terus buat anda celik dengan ayat pertama",
        },
      },
      {
        value: "light",
        emoji: "🌤",
        label: {
          en: "Ease you into the day",
          "zh-CN": "陪你慢慢醒过来",
          "ms-MY": "Teman anda bangun perlahan-lahan",
        },
      },
    ],
  },
  {
    id: "q3",
    prompt: {
      en: "When it comes to sweetness, you think—",
      "zh-CN": "关于「甜」，你的态度是——",
      "ms-MY": "Tentang rasa manis, anda rasa—",
    },
    options: [
      {
        value: "dolce",
        emoji: "🍯",
        label: {
          en: "Life is bitter enough already",
          "zh-CN": "生活已经够苦了",
          "ms-MY": "Hidup dah cukup pahit",
        },
      },
      {
        value: "bitter",
        emoji: "🖤",
        label: {
          en: "A little bitterness makes it memorable",
          "zh-CN": "苦一点才记得住",
          "ms-MY": "Sedikit pahit baru susah dilupakan",
        },
      },
    ],
  },
  {
    id: "q4",
    prompt: {
      en: "That perfect first sip is best when—",
      "zh-CN": "最好的那一口，你希望——",
      "ms-MY": "Teguk yang paling sedap terasa sempurna bila—",
    },
    options: [
      {
        value: "alone",
        emoji: "🎧",
        label: {
          en: "No one interrupts",
          "zh-CN": "没人打扰",
          "ms-MY": "Tiada siapa mengganggu",
        },
      },
      {
        value: "together",
        emoji: "👯",
        label: {
          en: "Someone’s there to share it",
          "zh-CN": "有人一起",
          "ms-MY": "Ada seseorang menikmatinya bersama",
        },
      },
    ],
  },
  {
    id: "q5",
    prompt: {
      en: "When do we see you most often?",
      "zh-CN": "你最常出现在——",
      "ms-MY": "Anda paling kerap singgah bila—",
    },
    options: [
      {
        value: "morning",
        emoji: "🌞",
        label: {
          en: "Before the sun gets fierce",
          "zh-CN": "太阳还没毒的时候",
          "ms-MY": "Sebelum matahari mula terik",
        },
      },
      {
        value: "night",
        emoji: "🌙",
        label: {
          en: "After the sun goes down",
          "zh-CN": "太阳下山之后",
          "ms-MY": "Selepas matahari terbenam",
        },
      },
    ],
  },
  {
    id: "q6",
    prompt: {
      en: "If you could take only one thing with you—",
      "zh-CN": "如果只能带走一样——",
      "ms-MY": "Kalau hanya boleh bawa pulang satu—",
    },
    options: [
      {
        value: "drink",
        emoji: "🥤",
        label: {
          en: "A cup",
          "zh-CN": "一杯",
          "ms-MY": "Secawan minuman",
        },
      },
      {
        value: "dessert",
        emoji: "🍰",
        label: {
          en: "A slice",
          "zh-CN": "一块",
          "ms-MY": "Sepotong pencuci mulut",
        },
      },
      {
        value: "bakery",
        emoji: "🥐",
        label: {
          en: "A bag",
          "zh-CN": "一袋",
          "ms-MY": "Sebungkus pastri",
        },
      },
    ],
  },
] as const satisfies readonly HbtiQuestion[];
