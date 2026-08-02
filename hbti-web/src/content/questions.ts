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
    // 甜度轴。原题「关于甜,你的立场」把测量维度直接摆上台面 —— 是问卷不是体验,
    // 老板评价「太直接」。改成试吃新配方给反馈:场景在烘焙房,但选的是**怎么开口**
    // (先护着人 vs 先说实话),不是选口味。与 q10「朋友难过时」区分:那是人际安慰,
    // 这是手艺反馈。
    prompt: {
      en: "A new recipe, still warm. They ask what you think—",
      "zh-CN": "新配方刚出炉，他问你觉得怎么样——",
      "ms-MY": "Resipi baharu, masih panas. Dia tanya pendapat anda—",
    },
    options: [
      {
        value: "dolce",
        emoji: "🤝",
        label: {
          en: "Lead with what works, then tune it together",
          "zh-CN": "先说做成的地方，再一起调",
          "ms-MY": "Puji yang menjadi, kemudian halusi",
        },
      },
      {
        value: "bitter",
        emoji: "🔍",
        label: {
          en: "Name the first fix while it's still warm",
          "zh-CN": "趁热点出第一个要改的",
          "ms-MY": "Tunjuk pembetulan selagi ia panas",
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
    id: "q7",
    prompt: {
      en: "When friends describe you, they'd say you're—",
      "zh-CN": "朋友聊起你，更可能说你是——",
      "ms-MY": "Bila kawan bercerita tentang anda, mereka kata anda—",
    },
    options: [
      {
        value: "hot",
        emoji: "🔥",
        label: {
          en: "Warm the moment someone gets close",
          "zh-CN": "靠近就觉得暖的人",
          "ms-MY": "Terasa hangat sebaik didekati",
        },
      },
      {
        value: "iced",
        emoji: "🧊",
        label: {
          en: "Refreshing the longer someone stays",
          "zh-CN": "越处越觉得清爽的人",
          "ms-MY": "Semakin lama semakin menyegarkan",
        },
      },
    ],
  },
  {
    id: "q9",
    prompt: {
      en: "In a new room, you usually—",
      "zh-CN": "到一个新环境，你通常——",
      "ms-MY": "Dalam suasana baru, anda selalunya—",
    },
    options: [
      {
        value: "strong",
        emoji: "⚡",
        label: {
          en: "Can't hide—people remember you fast",
          "zh-CN": "存在感藏不住，很快被记住",
          "ms-MY": "Susah nak senyap—cepat diingati",
        },
      },
      {
        value: "light",
        emoji: "🌤",
        label: {
          en: "Warm up slowly, but you linger",
          "zh-CN": "慢热，但后劲很长",
          "ms-MY": "Lambat panas, tapi kesannya lama",
        },
      },
    ],
  },
  {
    id: "q10",
    prompt: {
      en: "When a friend is down, your job is—",
      "zh-CN": "朋友难过的时候，你负责——",
      "ms-MY": "Bila kawan sedih, tugas anda—",
    },
    options: [
      {
        value: "dolce",
        emoji: "🍯",
        label: {
          en: "The sweet part: hug first, sky's not falling",
          "zh-CN": "说甜的：先抱一下，天塌不下来",
          "ms-MY": "Bahagian manis: peluk dulu, langit tak runtuh",
        },
      },
      {
        value: "bitter",
        emoji: "🖤",
        label: {
          en: "The honest part: someone has to say it",
          "zh-CN": "说真的：苦口的那句，总得有人讲",
          "ms-MY": "Bahagian jujur: ayat pahit itu perlu juga",
        },
      },
    ],
  },
  {
    id: "q13",
    prompt: {
      en: "A rare free weekend. You—",
      "zh-CN": "难得空出来的周末，你——",
      "ms-MY": "Hujung minggu yang jarang-jarang lapang. Anda—",
    },
    options: [
      {
        value: "alone",
        emoji: "🎧",
        label: {
          en: "Don't call me. I have plans with myself.",
          "zh-CN": "谁都别约我，我和自己有约",
          "ms-MY": "Jangan ajak saya. Saya ada janji dengan diri sendiri.",
        },
      },
      {
        value: "together",
        emoji: "👯",
        label: {
          en: "Straight to the group chat: everyone out!",
          "zh-CN": "立刻翻通讯录：都出来！",
          "ms-MY": "Terus buka group chat: semua keluar!",
        },
      },
    ],
  },
  {
    id: "q8",
    // 浓淡轴。原题「你喜欢的故事(和日子)」一个题干两个主语,老板评价「主体意义
    // 很不明确」;选项用「浓/淡」是口味词,和叙事主语对不上,也完全脱离烘焙。
    // 改成带新人:同样测「你把自己开到多大」,但落在烘焙房的真实动作上。
    // 与 q2(咖啡拟人)、q9(新环境)区分:那两个是被动感受与社交起手,这个是主动带人。
    prompt: {
      en: "Someone new starts today. You—",
      "zh-CN": "今天来了个新人，你——",
      "ms-MY": "Ada orang baharu hari ini. Anda—",
    },
    options: [
      {
        value: "strong",
        emoji: "⚡",
        label: {
          en: "Show the whole bake—they'll catch on",
          "zh-CN": "完整做一炉给他看，节奏一次就有了",
          "ms-MY": "Buat sekali habis—dia dapat iramanya",
        },
      },
      {
        value: "light",
        emoji: "🌤",
        label: {
          en: "Break it into steps, work alongside",
          "zh-CN": "拆成几步，陪着他一段一段来",
          "ms-MY": "Pecahkan ikut langkah, temani dia",
        },
      },
    ],
  },
  {
    id: "q11",
    // 甜度轴。原题「回忆过去,你最先想起」与 q3 语义过近(都在问偏甜还是偏苦),
    // 且完全脱离烘焙,老板评价「太片面、目的不明」。保留原题的魂(回望时先想起什么),
    // 但落到收工复盘这个烘焙房场景。三票现在是三种互不重叠的行为:
    // q3 手艺反馈 / q10 安慰朋友 / q11 自我复盘。两个选项都是称职的收工方式。
    prompt: {
      en: "Shutters down. What your mind replays is—",
      "zh-CN": "关店了，你脑子里回放的是——",
      "ms-MY": "Kedai tutup. Yang bermain semula dalam fikiran anda—",
    },
    options: [
      {
        value: "dolce",
        emoji: "🧺",
        label: {
          en: "The trays that sold out before noon",
          "zh-CN": "中午前就卖光的那几盘",
          "ms-MY": "Dulang yang habis sebelum tengah hari",
        },
      },
      {
        value: "bitter",
        emoji: "🔥",
        label: {
          en: "The over-baked batch—fixed tomorrow",
          "zh-CN": "烤过头的那一炉，明天不会了",
          "ms-MY": "Yang terlebih bakar—esok tidak lagi",
        },
      },
    ],
  },
  {
    id: "q12",
    prompt: {
      en: "How you recharge—",
      "zh-CN": "你的充电方式——",
      "ms-MY": "Cara anda mengecas semula—",
    },
    options: [
      {
        value: "alone",
        emoji: "🎧",
        label: {
          en: "Alone time. Crowds drain the battery.",
          "zh-CN": "独处：人多的场合费电",
          "ms-MY": "Bersendirian. Keramaian itu memenatkan.",
        },
      },
      {
        value: "together",
        emoji: "👯",
        label: {
          en: "People time. Too much quiet drains it.",
          "zh-CN": "见人：安静太久会没电",
          "ms-MY": "Berjumpa orang. Sunyi lama pun memenatkan.",
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
