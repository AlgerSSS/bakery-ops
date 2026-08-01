import type { HbtiQuestion } from "@/content/types";

export const questions = [
  {
    id: "q1",
    prompt: {
      en: "After a long day, which comfort do you want handed to you?",
      "zh-CN": "辛苦一天之后，你更想被怎样安慰？",
      "ms-MY":
        "Selepas hari yang panjang, pujukan mana yang anda mahu?",
    },
    options: [
      {
        value: "hot",
        emoji: "🔥",
        label: {
          en: "Something hot: 'Slow down. No rush.'",
          "zh-CN": "递来一杯烫的：『慢慢喝，不急。』",
          "ms-MY": "Yang panas: 'Minum perlahan, tak perlu terburu.'",
        },
      },
      {
        value: "iced",
        emoji: "🧊",
        label: {
          en: "Something iced: 'Wake up. It's fine now.'",
          "zh-CN": "递来一杯冰的：『醒一醒，没事了。』",
          "ms-MY": "Yang sejuk: 'Sedarlah, semuanya okey.'",
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
          en: "Wake you with the very first word",
          "zh-CN": "一开口就让你清醒",
          "ms-MY": "Terus sedarkan anda dengan ayat pertama",
        },
      },
      {
        value: "light",
        emoji: "🌤",
        label: {
          en: "Ease you into the day, no hurry",
          "zh-CN": "陪你慢慢醒过来",
          "ms-MY": "Temani anda bangun perlahan-lahan",
        },
      },
    ],
  },
  {
    id: "q3",
    prompt: {
      en: "Your official position on sweetness—",
      "zh-CN": "关于『甜』，你的立场——",
      "ms-MY": "Pendirian anda tentang manis—",
    },
    options: [
      {
        value: "dolce",
        emoji: "🍯",
        label: {
          en: "Life's bitter enough. Sweet is allowed.",
          "zh-CN": "生活已经够苦了，甜一点不丢人",
          "ms-MY": "Hidup dah cukup pahit. Manis itu halal.",
        },
      },
      {
        value: "bitter",
        emoji: "🖤",
        label: {
          en: "A little bitterness is what depth tastes like",
          "zh-CN": "有点苦，才尝得出层次",
          "ms-MY": "Sedikit pahit, baru terasa lapisannya",
        },
      },
    ],
  },
  {
    id: "q4",
    prompt: {
      en: "That first warm bite is best—",
      "zh-CN": "刚出炉的那一口，你希望——",
      "ms-MY": "Gigitan pertama yang masih panas paling sedap—",
    },
    options: [
      {
        value: "alone",
        emoji: "🎧",
        label: {
          en: "Alone, unhurried, no talking, no sharing",
          "zh-CN": "一个人慢慢来，不说话也不分享",
          "ms-MY": "Sendirian, perlahan, tanpa bicara",
        },
      },
      {
        value: "together",
        emoji: "👯",
        label: {
          en: "Split in half, watching someone's eyes light up",
          "zh-CN": "掰一半给旁边的人，看他眼睛亮起来",
          "ms-MY": "Dibahagi dua, melihat mata seseorang bersinar",
        },
      },
    ],
  },
  {
    id: "q5",
    prompt: {
      en: "You feel most like yourself—",
      "zh-CN": "你觉得自己最像自己的时刻——",
      "ms-MY": "Anda paling rasa diri sendiri—",
    },
    options: [
      {
        value: "morning",
        emoji: "🌞",
        label: {
          en: "Early morning, before the world gets loud",
          "zh-CN": "清晨，世界还没吵起来的时候",
          "ms-MY": "Awal pagi, sebelum dunia mula bising",
        },
      },
      {
        value: "night",
        emoji: "🌙",
        label: {
          en: "Late night, after the world finally quiets down",
          "zh-CN": "深夜，世界终于安静下来的时候",
          "ms-MY": "Larut malam, selepas dunia akhirnya senyap",
        },
      },
    ],
  },
  {
    id: "q6",
    prompt: {
      en: "If happiness came in takeaway, you'd take—",
      "zh-CN": "如果快乐可以打包，你带走——",
      "ms-MY": "Kalau kebahagiaan boleh dibungkus, anda bawa—",
    },
    options: [
      {
        value: "drink",
        emoji: "🥤",
        label: {
          en: "A cup: company you can carry",
          "zh-CN": "一杯：能边走边喝的陪伴",
          "ms-MY": "Secawan: teman yang boleh dibawa berjalan",
        },
      },
      {
        value: "dessert",
        emoji: "🍰",
        label: {
          en: "A slice: tonight's little ceremony",
          "zh-CN": "一块：留给今晚独处的仪式",
          "ms-MY": "Sepotong: upacara kecil malam ini",
        },
      },
      {
        value: "bakery",
        emoji: "🥐",
        label: {
          en: "A bag: tomorrow's breakfast, already loved",
          "zh-CN": "一袋：连明天早餐都照顾好",
          "ms-MY": "Sebungkus: sarapan esok pun sudah dijaga",
        },
      },
    ],
  },
] as const satisfies readonly HbtiQuestion[];
