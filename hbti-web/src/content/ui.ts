import type { Localized } from "@/content/types";

export interface UiCopy {
  brand: string;
  hbti: string;
  languageLabel: string;
  questionNavigationLabel: string;
  hbtiTypeLabel: (code: string) => string;
  authEyebrow: string;
  authTitle: string;
  authBody: string;
  countryLabel: string;
  phoneLabel: string;
  phoneHint: string;
  membershipConsent: string;
  sendCode: string;
  sendingCode: string;
  codeSent: string;
  changePhone: string;
  codeLabel: string;
  verifyCode: string;
  verifyingCode: string;
  resendCode: string;
  resendIn: (seconds: number) => string;
  invalidPhone: string;
  invalidCode: string;
  codeExpired: string;
  tooManyAttempts: string;
  rateLimited: string;
  captchaRequired: string;
  authErrorTitle: string;
  authNetworkError: string;
  conflictTitle: string;
  conflictBody: string;
  confirmConflict: string;
  membershipTitle: string;
  membershipBody: string;
  confirmMembership: string;
  useAnotherPhone: string;
  checkingAccount: string;
  memberLinked: string;
  memberLinkedBody: (maskedPhone: string) => string;
  demoModeTitle: string;
  demoModeBody: string;
  demoCompleteEyebrow: string;
  demoCompleteTitle: string;
  demoCompleteBody: string;
  demoRewardLabel: string;
  demoRewardNote: string;
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
    hbtiTypeLabel: (code) => `HBTI bread type ${code}`,
    authEyebrow: "Hot Crush · Fresh out",
    authTitle: "Freshly made. Unmistakably you.",
    authBody:
      "Verify the phone number you use with Hot Crush. Your result and gift will stay together in that member account.",
    countryLabel: "Country or region",
    phoneLabel: "Member phone number",
    phoneHint: "We’ll text a six-digit code. Standard SMS rates may apply.",
    membershipConsent:
      "By continuing, you agree that we may create a Hot Crush member account for this number if one does not exist yet.",
    sendCode: "Send verification code",
    sendingCode: "Sending your code…",
    codeSent: "Code sent to",
    changePhone: "Change",
    codeLabel: "Six-digit code",
    verifyCode: "Verify and begin",
    verifyingCode: "Checking your code…",
    resendCode: "Send a new code",
    resendIn: (seconds) => `Send a new code in ${seconds}s`,
    invalidPhone: "Enter a valid mobile number for the selected country.",
    invalidCode: "Enter the six-digit code from your SMS.",
    codeExpired: "That code has expired. Send a new code to continue.",
    tooManyAttempts: "Too many attempts. Send a new code to continue.",
    rateLimited: "Please wait a moment before requesting another code.",
    captchaRequired:
      "Phone verification is temporarily unavailable. Please try again later.",
    authErrorTitle: "We couldn’t verify your account.",
    authNetworkError:
      "We couldn’t connect to member verification. Check your connection and try again.",
    conflictTitle: "Use this member account?",
    conflictBody:
      "RES found another sign-in connected to this phone number. Confirm to keep this phone as the account you use for HBTI.",
    confirmConflict: "Yes, use this account",
    membershipTitle: "Join Hot Crush membership?",
    membershipBody:
      "This number is not a member yet. Join now so your HBTI gift can be added to the same account.",
    confirmMembership: "Join and continue",
    useAnotherPhone: "Use another phone number",
    checkingAccount: "Checking your Hot Crush member account…",
    memberLinked: "Member account verified",
    memberLinkedBody: (maskedPhone) =>
      `Your HBTI gift will be added to ${maskedPhone}.`,
    demoModeTitle: "Guest preview",
    demoModeBody: "Browse freely—meet all sixteen breads without signing in.",
    demoCompleteEyebrow: "Preview complete",
    demoCompleteTitle: "That’s the full HBTI experience.",
    demoCompleteBody:
      "This guest preview does not create a member account or issue a coupon.",
    demoRewardLabel: "Live member reward",
    demoRewardNote: "Preview only · no coupon issued",
    landingEyebrow: "Hot Crush · Member experience",
    landingTitle: "Your bread personality might know you better than you do.",
    landingBody:
      "A dozen small choices reveal how you proof, how you bake, and how people remember you.",
    landingNote:
      "Your personal test link arrives by SMS after you join our member programme.",
    invitationOnly: "Open your SMS invitation to begin",
    introEyebrow: "Freshly Crafted Every Day",
    introTitle: "Which bread on our shelf is you?",
    introBody:
      "Sixteen bread personalities, baked fresh every morning. A few small questions to claim the one with your name on it.",
    introTime: "13 little choices · about 60 seconds",
    introReward: "P.S. There's a little something waiting at the counter once yours is out of the oven.",
    begin: "Claim my bread",
    resume: "The dough's still proofing—continue",
    back: "Back",
    next: "Next",
    questionProgress: (current, total) => `Choice ${current} of ${total}`,
    chooseOne: "Go with your first instinct—overproofed dough goes flat.",
    resultEyebrow: "Fresh from the oven · Your HBTI",
    resultTitle: "Fresh out of the oven: you.",
    signatureLabel: "Your table order",
    discoverGift: "Collect my fresh-out gift",
    retake: "Bake it again",
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
    sendGift: "Out of the oven!",
    sendingGift: "Wrapping it up…",
    saveCard: "Save my bread card",
    shareCard: "Send a friend to the shelf",
    cardSaved: "Your HBTI card has been saved.",
    cardShared: "Your HBTI card is ready to share.",
    shareCopied: "A token-free result link has been copied.",
    cardActionError: "The card could not be prepared. Please try again.",
    returnToMembership: "Back to my Hot Crush member wallet",
    successEyebrow: "Still warm · For your next visit",
    successTitle: "Your gift is in your member wallet.",
    successBody:
      "It’s ready in the Hot Crush account you just verified.",
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
    hbtiTypeLabel: (code) => `HBTI 面包性格 ${code}`,
    authEyebrow: "Hot Crush · 新鲜出炉",
    authTitle: "新鲜出炉，刚好是你。",
    authBody:
      "请验证你在 Hot Crush 使用的手机号。测试结果和周边兑换券都会进入同一个会员账户。",
    countryLabel: "国家或地区",
    phoneLabel: "会员手机号",
    phoneHint: "我们会发送一条 6 位验证码短信，运营商可能收取短信费用。",
    membershipConsent:
      "继续即表示你同意：如果这个手机号还没有 Hot Crush 会员账户，我们可以为你创建一个。",
    sendCode: "发送验证码",
    sendingCode: "正在发送验证码…",
    codeSent: "验证码已发送至",
    changePhone: "修改",
    codeLabel: "6 位验证码",
    verifyCode: "验证并开始",
    verifyingCode: "正在验证…",
    resendCode: "重新发送验证码",
    resendIn: (seconds) => `${seconds} 秒后可重新发送`,
    invalidPhone: "请输入所选国家或地区的有效手机号。",
    invalidCode: "请输入短信里的 6 位验证码。",
    codeExpired: "验证码已经过期，请重新发送。",
    tooManyAttempts: "尝试次数过多，请重新发送验证码。",
    rateLimited: "请求太频繁，请稍等片刻再试。",
    captchaRequired: "手机号验证暂时不可用，请稍后再试。",
    authErrorTitle: "暂时无法验证你的账户。",
    authNetworkError: "暂时无法连接会员验证，请检查网络后再试。",
    conflictTitle: "使用这个会员账户吗？",
    conflictBody:
      "RES 发现这个手机号还关联了其他登录方式。确认后，将使用这个手机号对应的账户完成 HBTI。",
    confirmConflict: "确认使用这个账户",
    membershipTitle: "加入 Hot Crush 会员吗？",
    membershipBody:
      "这个手机号还不是会员。现在加入，HBTI 周边兑换券就会进入同一个账户。",
    confirmMembership: "加入并继续",
    useAnotherPhone: "换一个手机号",
    checkingAccount: "正在确认你的 Hot Crush 会员账户…",
    memberLinked: "会员账户已验证",
    memberLinkedBody: (maskedPhone) =>
      `HBTI 周边兑换券会进入 ${maskedPhone} 的账户。`,
    demoModeTitle: "访客预览",
    demoModeBody: "先随便逛逛，不登录也能把 16 块面包看完。",
    demoCompleteEyebrow: "预览完成",
    demoCompleteTitle: "这就是完整的 HBTI 体验。",
    demoCompleteBody: "访客预览不会创建会员账户，也不会发放优惠券。",
    demoRewardLabel: "正式会员礼物",
    demoRewardNote: "仅供预览 · 不会发券",
    landingEyebrow: "Hot Crush · 会员体验",
    landingTitle: "你的面包性格，可能比你更懂你。",
    landingBody: "十几个小选择，看看你怎样发酵、怎样出炉、怎样被人记住。",
    landingNote: "加入会员后，你会通过短信收到专属测试链接。",
    invitationOnly: "请从短信里的专属邀请进入",
    introEyebrow: "Freshly Crafted Every Day · 每日新鲜制作",
    introTitle: "你是货架上的哪一块？",
    introBody: "16 种面包性格，每天新鲜出炉。几个小问题，认领那块和你同名的。",
    introTime: "13 个小选择 · 大约 60 秒",
    introReward: "顺便说一句：出炉之后，柜台有一份小心意等你。",
    begin: "认领我的面包",
    resume: "面团还醒着，接着来",
    back: "返回",
    next: "下一题",
    questionProgress: (current, total) => `第 ${current} / ${total} 题`,
    chooseOne: "凭第一感觉选。面团醒过头，就不松软了。",
    resultEyebrow: "刚出炉 · 你的 HBTI",
    resultTitle: "刚出炉的，是你。",
    signatureLabel: "你的专属搭配",
    discoverGift: "收下这份出炉礼",
    retake: "重烤一次",
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
    sendGift: "出炉！",
    sendingGift: "正在装袋…",
    saveCard: "保存我的面包卡",
    shareCard: "给朋友也测一块",
    cardSaved: "HBTI 人格卡已经保存。",
    cardShared: "HBTI 人格卡已经准备好分享。",
    shareCopied: "不含私人邀请的结果链接已复制。",
    cardActionError: "暂时无法生成人格卡，请再试一次。",
    returnToMembership: "返回 Hot Crush 会员账户",
    successEyebrow: "趁热 · 留给下次见面的礼物",
    successTitle: "礼物券已放进你的会员账户。",
    successBody: "它已经进入你刚刚验证的 Hot Crush 账户。",
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
    hbtiTypeLabel: (code) => `Jenis roti HBTI ${code}`,
    authEyebrow: "Hot Crush · Segar dibuat",
    authTitle: "Dibuat segar. Seunik diri anda.",
    authBody:
      "Sahkan nombor telefon yang anda gunakan dengan Hot Crush. Keputusan dan kupon hadiah anda akan berada dalam akaun ahli yang sama.",
    countryLabel: "Negara atau rantau",
    phoneLabel: "Nombor telefon ahli",
    phoneHint:
      "Kami akan menghantar kod enam digit melalui SMS. Caj SMS biasa mungkin dikenakan.",
    membershipConsent:
      "Dengan meneruskan, anda bersetuju bahawa kami boleh mencipta akaun ahli Hot Crush untuk nombor ini jika akaun belum wujud.",
    sendCode: "Hantar kod pengesahan",
    sendingCode: "Sedang menghantar kod…",
    codeSent: "Kod dihantar ke",
    changePhone: "Tukar",
    codeLabel: "Kod enam digit",
    verifyCode: "Sahkan dan mula",
    verifyingCode: "Sedang menyemak kod…",
    resendCode: "Hantar kod baharu",
    resendIn: (seconds) => `Hantar kod baharu dalam ${seconds}s`,
    invalidPhone: "Masukkan nombor mudah alih yang sah untuk negara dipilih.",
    invalidCode: "Masukkan kod enam digit daripada SMS anda.",
    codeExpired: "Kod itu telah tamat tempoh. Hantar kod baharu untuk teruskan.",
    tooManyAttempts: "Terlalu banyak percubaan. Hantar kod baharu untuk teruskan.",
    rateLimited: "Tunggu sebentar sebelum meminta kod baharu.",
    captchaRequired:
      "Pengesahan telefon tidak tersedia buat sementara waktu. Cuba lagi kemudian.",
    authErrorTitle: "Kami tidak dapat mengesahkan akaun anda.",
    authNetworkError:
      "Kami tidak dapat menyambung ke pengesahan ahli. Semak sambungan anda dan cuba lagi.",
    conflictTitle: "Gunakan akaun ahli ini?",
    conflictBody:
      "RES menemui log masuk lain yang dikaitkan dengan nombor ini. Sahkan untuk menggunakan akaun telefon ini bagi HBTI.",
    confirmConflict: "Ya, gunakan akaun ini",
    membershipTitle: "Sertai keahlian Hot Crush?",
    membershipBody:
      "Nombor ini belum menjadi ahli. Sertai sekarang supaya hadiah HBTI anda masuk ke akaun yang sama.",
    confirmMembership: "Sertai dan teruskan",
    useAnotherPhone: "Gunakan nombor telefon lain",
    checkingAccount: "Sedang menyemak akaun ahli Hot Crush anda…",
    memberLinked: "Akaun ahli telah disahkan",
    memberLinkedBody: (maskedPhone) =>
      `Hadiah HBTI anda akan dimasukkan ke ${maskedPhone}.`,
    demoModeTitle: "Pratonton tetamu",
    demoModeBody: "Lihat-lihat dulu—jumpa semua enam belas roti tanpa log masuk.",
    demoCompleteEyebrow: "Pratonton selesai",
    demoCompleteTitle: "Itulah pengalaman HBTI yang lengkap.",
    demoCompleteBody:
      "Pratonton tetamu ini tidak mencipta akaun ahli atau mengeluarkan kupon.",
    demoRewardLabel: "Ganjaran ahli sebenar",
    demoRewardNote: "Pratonton sahaja · tiada kupon dikeluarkan",
    landingEyebrow: "Hot Crush · Pengalaman ahli",
    landingTitle: "Personaliti roti anda mungkin lebih memahami anda.",
    landingBody:
      "Belasan pilihan kecil mendedahkan cara anda menunggu, cara anda matang, dan cara orang mengingati anda.",
    landingNote:
      "Selepas menyertai program ahli, pautan ujian peribadi akan dihantar melalui SMS.",
    invitationOnly: "Buka jemputan SMS anda untuk bermula",
    introEyebrow: "Freshly Crafted Every Day · Segar setiap hari",
    introTitle: "Anda roti yang mana di rak kami?",
    introBody:
      "Enam belas personaliti roti, dibakar segar setiap pagi. Beberapa soalan kecil untuk menuntut yang tertulis nama anda.",
    introTime: "13 pilihan kecil · kira-kira 60 saat",
    introReward: "P.S. Ada sedikit buah tangan menanti di kaunter selepas roti anda keluar ketuhar.",
    begin: "Tuntut roti saya",
    resume: "Doh masih menunggu—sambung",
    back: "Kembali",
    next: "Seterusnya",
    questionProgress: (current, total) => `Pilihan ${current} daripada ${total}`,
    chooseOne: "Ikut naluri pertama—doh yang terlebih menunggu akan kempis.",
    resultEyebrow: "Baru keluar ketuhar · HBTI anda",
    resultTitle: "Baru keluar dari ketuhar: anda.",
    signatureLabel: "Pesanan khas anda",
    discoverGift: "Terima hadiah keluar ketuhar",
    retake: "Bakar sekali lagi",
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
    sendGift: "Keluar ketuhar!",
    sendingGift: "Sedang dibungkus…",
    saveCard: "Simpan kad roti saya",
    shareCard: "Ajak kawan pilih roti",
    cardSaved: "Kad HBTI anda telah disimpan.",
    cardShared: "Kad HBTI anda sedia untuk dikongsi.",
    shareCopied: "Pautan keputusan tanpa jemputan peribadi telah disalin.",
    cardActionError: "Kad tidak dapat disediakan. Sila cuba lagi.",
    returnToMembership: "Kembali ke dompet ahli Hot Crush",
    successEyebrow: "Masih panas · Untuk kunjungan seterusnya",
    successTitle: "Hadiah anda ada dalam dompet ahli.",
    successBody:
      "Ia sedia dalam akaun Hot Crush yang baru anda sahkan.",
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
