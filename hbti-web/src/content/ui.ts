import type { Localized } from "@/content/types";

export interface UiCopy {
  brand: string;
  hbti: string;
  languageLabel: string;
  questionNavigationLabel: string;
  hbtiTypeLabel: (code: string) => string;
  landingEyebrow: string;
  landingTitle: string;
  landingBody: string;
  landingNote: string;
  invitationOnly: string;
  introEyebrow: string;
  introTitle: string;
  introBody: string;
  introTime: string;
  introReward: string;
  begin: string;
  resume: string;
  back: string;
  next: string;
  questionProgress: (current: number, total: number) => string;
  chooseOne: string;
  resultEyebrow: string;
  resultTitle: string;
  signatureLabel: string;
  discoverGift: string;
  retake: string;
  detailsEyebrow: string;
  detailsTitle: string;
  detailsBody: string;
  colorLabel: string;
  colorHint: string;
  genderLabel: string;
  ageLabel: string;
  optional: string;
  privacySummary: string;
  minorPrivacyNote: string;
  colors: Record<ColorChoice, string>;
  genders: Record<GenderChoice, string>;
  ages: Record<AgeChoice, string>;
  sendGift: string;
  sendingGift: string;
  saveCard: string;
  shareCard: string;
  cardSaved: string;
  cardShared: string;
  shareCopied: string;
  cardActionError: string;
  returnToMembership: string;
  successEyebrow: string;
  successTitle: string;
  successBody: string;
  rewardLabel: string;
  rewardName: string;
  rewardNote: string;
  openWallet: string;
  processingTitle: string;
  processingBody: string;
  reviewTitle: string;
  reviewBody: string;
  invalidTitle: string;
  invalidBody: string;
  validating: string;
  networkError: string;
  retry: string;
  saved: string;
}

export const colorChoices = [
  "cherry",
  "blush",
  "apricot",
  "sunshine",
  "pistachio",
  "sky",
  "lavender",
  "cocoa",
  "cream",
] as const;
export type ColorChoice = (typeof colorChoices)[number];

export const genderChoices = [
  "woman",
  "man",
  "nonbinary",
  "prefer-not",
] as const;
export type GenderChoice = (typeof genderChoices)[number];

export const ageChoices = [
  "under-18",
  "18-24",
  "25-34",
  "35-44",
  "45-plus",
  "prefer-not",
] as const;
export type AgeChoice = (typeof ageChoices)[number];

export const uiCopy: Localized<UiCopy> = {
  en: {
    brand: "SEE YOU OFTEN",
    hbti: "HBTI",
    languageLabel: "Language",
    questionNavigationLabel: "Question navigation",
    hbtiTypeLabel: (code) => `HBTI type ${code}`,
    landingEyebrow: "Hot Crush · Member experience",
    landingTitle: "Your coffee personality might know you better than you do.",
    landingBody:
      "Six small choices reveal the way you like to drink, pause, and spend time with people.",
    landingNote:
      "Your personal test link arrives by SMS after you join our member programme.",
    invitationOnly: "Open your SMS invitation to begin",
    introEyebrow: "A little test, made for you",
    introTitle: "What kind of coffee person are you?",
    introBody:
      "There are no right answers here—only the cup, mood, and company that feel most like you.",
    introTime: "6 choices · about 40 seconds",
    introReward: "Finish to receive your member gift coupon.",
    begin: "Start my HBTI",
    resume: "Continue where I left off",
    back: "Back",
    next: "Next",
    questionProgress: (current, total) => `Choice ${current} of ${total}`,
    chooseOne: "Choose the answer that feels most natural.",
    resultEyebrow: "Your coffee personality",
    resultTitle: "This feels like you.",
    signatureLabel: "Your table order",
    discoverGift: "Receive my member gift",
    retake: "Change my answers",
    detailsEyebrow: "One last little detail",
    detailsTitle: "Choose the colour you’d reach for.",
    detailsBody:
      "Your colour helps us prepare better member gifts. The other two details are optional.",
    colorLabel: "Favourite colour",
    colorHint: "Please choose one colour.",
    genderLabel: "Gender",
    ageLabel: "Age range",
    optional: "Optional",
    privacySummary:
      "Your result, colour and optional details are kept for up to 18 months to provide your reward and improve member gifts. Ask our team if you want them removed.",
    minorPrivacyNote:
      "Under 18? Please ask a parent or guardian before adding optional details.",
    colors: {
      cherry: "Cherry red",
      blush: "Blush pink",
      apricot: "Apricot",
      sunshine: "Sunshine",
      pistachio: "Pistachio green",
      sky: "Powder blue",
      lavender: "Lavender",
      cocoa: "Deep cocoa",
      cream: "Warm cream",
    },
    genders: {
      woman: "Woman",
      man: "Man",
      nonbinary: "Non-binary",
      "prefer-not": "Prefer not to say",
    },
    ages: {
      "under-18": "Under 18",
      "18-24": "18–24",
      "25-34": "25–34",
      "35-44": "35–44",
      "45-plus": "45+",
      "prefer-not": "Prefer not to say",
    },
    sendGift: "Send my gift coupon",
    sendingGift: "Adding it to your account…",
    saveCard: "Save my card",
    shareCard: "Share with a friend",
    cardSaved: "Your HBTI card has been saved.",
    cardShared: "Your HBTI card is ready to share.",
    shareCopied: "A token-free result link has been copied.",
    cardActionError: "The card could not be prepared. Please try again.",
    returnToMembership: "Back to my Hot Crush member wallet",
    successEyebrow: "Made for your next visit",
    successTitle: "Your gift is ready.",
    successBody:
      "We’ve added the coupon to the same Hot Crush member account that received this link.",
    rewardLabel: "Your member reward",
    rewardName: "Pistachio Green Jewel",
    rewardNote: "Physical Gift Coupon · one-time redemption",
    openWallet: "View it in my member wallet",
    processingTitle: "Your gift is being prepared.",
    processingBody:
      "Keep this page open for a moment. Your result is saved and we’re confirming the coupon.",
    reviewTitle: "Your result is safe with us.",
    reviewBody:
      "We couldn’t confirm the coupon just yet. Please show this screen to our team on your next visit.",
    invalidTitle: "This invitation can’t be opened.",
    invalidBody:
      "The link may have expired or already been replaced. Ask our team for a fresh HBTI invitation.",
    validating: "Opening your invitation…",
    networkError:
      "The connection paused before we could finish. Your answers are still here.",
    retry: "Try again",
    saved: "Your progress is saved on this device.",
  },
  "zh-CN": {
    brand: "SEE YOU OFTEN",
    hbti: "HBTI",
    languageLabel: "语言",
    questionNavigationLabel: "答题导航",
    hbtiTypeLabel: (code) => `HBTI 人格类型 ${code}`,
    landingEyebrow: "Hot Crush · 会员体验",
    landingTitle: "你的咖啡人格，可能比你更懂你。",
    landingBody: "六个小选择，看看你喜欢怎样喝、怎样停下来、怎样与人相处。",
    landingNote: "加入会员后，你会通过短信收到专属测试链接。",
    invitationOnly: "请从短信里的专属邀请进入",
    introEyebrow: "一份只属于你的小测试",
    introTitle: "你是哪一种咖啡人？",
    introBody: "这里没有正确答案，只有最像你的那杯咖啡、那种心情和那个人。",
    introTime: "6 个选择 · 大约 40 秒",
    introReward: "完成后，会员礼物券会直接进入你的账户。",
    begin: "进入 HBTI 测试",
    resume: "继续上次的进度",
    back: "返回",
    next: "下一题",
    questionProgress: (current, total) => `第 ${current} / ${total} 题`,
    chooseOne: "选择第一感觉最像你的答案。",
    resultEyebrow: "你的咖啡人格",
    resultTitle: "这很像你。",
    signatureLabel: "你的专属搭配",
    discoverGift: "领取我的会员礼物",
    retake: "修改答案",
    detailsEyebrow: "最后一个小问题",
    detailsTitle: "选一个你第一眼会拿起的颜色。",
    detailsBody: "颜色会帮助我们准备更合适的会员周边，其他两项可以不填。",
    colorLabel: "喜欢的颜色",
    colorHint: "请选择一个颜色。",
    genderLabel: "性别",
    ageLabel: "年龄段",
    optional: "选填",
    privacySummary:
      "你的测试结果、颜色及选填资料会保存最多 18 个月，用于发放奖励和改善会员周边。如需删除，请联系门店团队。",
    minorPrivacyNote: "未满 18 岁？填写选填资料前，请先征得父母或监护人同意。",
    colors: {
      cherry: "樱桃红",
      blush: "浅肉粉",
      apricot: "杏桃橙",
      sunshine: "暖阳黄",
      pistachio: "开心果绿",
      sky: "雾霾蓝",
      lavender: "薰衣草紫",
      cocoa: "深可可",
      cream: "暖奶油",
    },
    genders: {
      woman: "女性",
      man: "男性",
      nonbinary: "非二元",
      "prefer-not": "不想回答",
    },
    ages: {
      "under-18": "18 岁以下",
      "18-24": "18–24 岁",
      "25-34": "25–34 岁",
      "35-44": "35–44 岁",
      "45-plus": "45 岁以上",
      "prefer-not": "不想回答",
    },
    sendGift: "把礼物券发到我的账户",
    sendingGift: "正在放进你的账户…",
    saveCard: "保存我的人格卡",
    shareCard: "分享给朋友",
    cardSaved: "HBTI 人格卡已经保存。",
    cardShared: "HBTI 人格卡已经准备好分享。",
    shareCopied: "不含私人邀请的结果链接已复制。",
    cardActionError: "暂时无法生成人格卡，请再试一次。",
    returnToMembership: "返回 Hot Crush 会员账户",
    successEyebrow: "留给下次见面的礼物",
    successTitle: "你的礼物准备好了。",
    successBody: "礼物券已经进入收到这条链接的 Hot Crush 会员账户。",
    rewardLabel: "你的会员礼物",
    rewardName: "Pistachio Green Jewel",
    rewardNote: "周边实物兑换券 · 仅可兑换一次",
    openWallet: "去会员账户查看",
    processingTitle: "正在准备你的礼物。",
    processingBody: "请暂时保留这个页面。你的结果已经保存，我们正在确认礼物券。",
    reviewTitle: "你的结果已经保存。",
    reviewBody: "目前还没能确认礼物券，下次到店时请把这个页面给店员看。",
    invalidTitle: "这个邀请暂时无法打开。",
    invalidBody: "链接可能已经过期或被替换，请联系店员获取新的 HBTI 邀请。",
    validating: "正在打开你的邀请…",
    networkError: "网络在完成前暂停了，但你的答案还在。",
    retry: "再试一次",
    saved: "进度已保存在这台设备上。",
  },
  "ms-MY": {
    brand: "SEE YOU OFTEN",
    hbti: "HBTI",
    languageLabel: "Bahasa",
    questionNavigationLabel: "Navigasi soalan",
    hbtiTypeLabel: (code) => `Jenis HBTI ${code}`,
    landingEyebrow: "Hot Crush · Pengalaman ahli",
    landingTitle: "Personaliti kopi anda mungkin lebih memahami anda.",
    landingBody:
      "Enam pilihan kecil mendedahkan cara anda menikmati minuman, berehat, dan meluangkan masa bersama orang lain.",
    landingNote:
      "Selepas menyertai program ahli, pautan ujian peribadi akan dihantar melalui SMS.",
    invitationOnly: "Buka jemputan SMS anda untuk bermula",
    introEyebrow: "Ujian kecil, khas untuk anda",
    introTitle: "Anda jenis pencinta kopi yang mana?",
    introBody:
      "Tiada jawapan betul atau salah—hanya cawan, suasana, dan teman yang paling serasi dengan diri anda.",
    introTime: "6 pilihan · kira-kira 40 saat",
    introReward: "Selesaikan ujian untuk menerima kupon hadiah ahli.",
    begin: "Mulakan ujian HBTI",
    resume: "Sambung dari tempat terakhir",
    back: "Kembali",
    next: "Seterusnya",
    questionProgress: (current, total) => `Pilihan ${current} daripada ${total}`,
    chooseOne: "Pilih jawapan yang terasa paling semula jadi.",
    resultEyebrow: "Personaliti kopi anda",
    resultTitle: "Inilah diri anda.",
    signatureLabel: "Pesanan khas anda",
    discoverGift: "Terima hadiah ahli saya",
    retake: "Ubah jawapan saya",
    detailsEyebrow: "Satu butiran kecil lagi",
    detailsTitle: "Pilih warna yang terus menarik perhatian anda.",
    detailsBody:
      "Warna ini membantu kami menyediakan hadiah ahli yang lebih sesuai. Dua butiran lain adalah pilihan.",
    colorLabel: "Warna kegemaran",
    colorHint: "Sila pilih satu warna.",
    genderLabel: "Jantina",
    ageLabel: "Julat umur",
    optional: "Pilihan",
    privacySummary:
      "Keputusan, warna dan butiran pilihan anda disimpan sehingga 18 bulan untuk memberikan ganjaran dan menambah baik hadiah ahli. Hubungi pasukan kami jika anda mahu memadamkannya.",
    minorPrivacyNote:
      "Bawah 18 tahun? Minta izin ibu bapa atau penjaga sebelum menambah butiran pilihan.",
    colors: {
      cherry: "Merah ceri",
      blush: "Merah jambu lembut",
      apricot: "Aprikot",
      sunshine: "Kuning mentari",
      pistachio: "Hijau pistachio",
      sky: "Biru lembut",
      lavender: "Lavender",
      cocoa: "Koko gelap",
      cream: "Krim hangat",
    },
    genders: {
      woman: "Wanita",
      man: "Lelaki",
      nonbinary: "Bukan binari",
      "prefer-not": "Tidak mahu nyatakan",
    },
    ages: {
      "under-18": "Bawah 18",
      "18-24": "18–24",
      "25-34": "25–34",
      "35-44": "35–44",
      "45-plus": "45+",
      "prefer-not": "Tidak mahu nyatakan",
    },
    sendGift: "Hantar kupon hadiah saya",
    sendingGift: "Sedang dimasukkan ke akaun anda…",
    saveCard: "Simpan kad saya",
    shareCard: "Kongsi dengan rakan",
    cardSaved: "Kad HBTI anda telah disimpan.",
    cardShared: "Kad HBTI anda sedia untuk dikongsi.",
    shareCopied: "Pautan keputusan tanpa jemputan peribadi telah disalin.",
    cardActionError: "Kad tidak dapat disediakan. Sila cuba lagi.",
    returnToMembership: "Kembali ke dompet ahli Hot Crush",
    successEyebrow: "Untuk kunjungan anda yang seterusnya",
    successTitle: "Hadiah anda sudah sedia.",
    successBody:
      "Kupon telah dimasukkan ke akaun ahli Hot Crush yang menerima pautan ini.",
    rewardLabel: "Ganjaran ahli anda",
    rewardName: "Pistachio Green Jewel",
    rewardNote: "Kupon Hadiah Fizikal · penebusan sekali sahaja",
    openWallet: "Lihat dalam dompet ahli saya",
    processingTitle: "Hadiah anda sedang disediakan.",
    processingBody:
      "Biarkan halaman ini terbuka sebentar. Keputusan anda telah disimpan dan kami sedang mengesahkan kupon.",
    reviewTitle: "Keputusan anda selamat bersama kami.",
    reviewBody:
      "Kupon belum dapat disahkan. Tunjukkan skrin ini kepada pasukan kami ketika kunjungan anda nanti.",
    invalidTitle: "Jemputan ini tidak dapat dibuka.",
    invalidBody:
      "Pautan mungkin telah tamat tempoh atau diganti. Minta pasukan kami menghantar jemputan HBTI yang baharu.",
    validating: "Sedang membuka jemputan anda…",
    networkError:
      "Sambungan terhenti sebelum selesai. Jawapan anda masih tersimpan.",
    retry: "Cuba lagi",
    saved: "Kemajuan anda disimpan pada peranti ini.",
  },
};
