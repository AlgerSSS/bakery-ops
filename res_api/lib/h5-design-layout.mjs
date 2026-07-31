const PALETTE = Object.freeze({
  cocoa: "#84534D",
  cocoaDark: "#59231B",
  cream: "#F9F2E3",
  pistachio: "#B4C876",
  walnut: "#806D5E",
  tan: "#C9A07D",
  flesh: "#EFCBC6",
  blush: "#FAE9E6",
  white: "#FFFFFF",
});

const LOGO_URL = "//img03.uat.restosuite.ai/image/c0/816112-20250722.png";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseJsonField(value, label) {
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  if (value && typeof value === "object") {
    return clone(value);
  }
  throw new Error(`${label} must be an object or a JSON string`);
}

function findPrototype(tree, resolvedName) {
  const entry = Object.values(tree).find(
    (node) => node?.type?.resolvedName === resolvedName,
  );
  if (!entry) {
    throw new Error(`Home page does not contain a ${resolvedName} prototype`);
  }
  return entry;
}

function makeContainer(prototype, id, parent, styleProps, nodes = []) {
  const node = clone(prototype);
  node.parent = parent;
  node.nodes = nodes;
  node.hidden = false;
  node.props.styleProps = {
    ...node.props.styleProps,
    marginTop: "0px",
    marginBottom: "0px",
    marginLeft: "0px",
    marginRight: "0px",
    borderTopLeftRadius: "0px",
    borderTopRightRadius: "0px",
    borderBottomRightRadius: "0px",
    borderBottomLeftRadius: "0px",
    ...styleProps,
  };
  node.props.data = {};
  node.props.events = {};
  return [id, node];
}

function makeText(
  prototype,
  id,
  parent,
  {
    en,
    zh,
    ms,
    top,
    left,
    width,
    height,
    size,
    color,
    align = "left",
    font = "OPPOSans",
    zhFont = "阿里妈妈方圆体",
    bold = false,
    lineHeight,
  },
) {
  const node = clone(prototype);
  node.parent = parent;
  node.nodes = [];
  node.hidden = false;
  node.props.data = {
    langKey: "",
    bindProp: "1",
    alias: "",
    fText: {
      value: en,
      valueML: { en_US: en, zh_CN: zh, ms_MY: ms },
      extML: {
        en_US: {
          content: [{
            value: en,
            font,
            size,
            color,
            bold,
            rowFlex: align,
          }],
        },
        zh_CN: {
          content: [{
            value: zh,
            font: zhFont,
            size,
            color,
            bold,
            rowFlex: align,
          }],
        },
        ms_MY: {
          content: [{
            value: ms,
            font,
            size,
            color,
            bold,
            rowFlex: align,
          }],
        },
      },
    },
  };
  node.props.styleProps = {
    ...node.props.styleProps,
    position: "absolute",
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
    fontSize: `${size}px`,
    "x-style-fontSize": size,
    color,
    textAlign: align,
    fontWeight: bold ? "bold" : "normal",
    lineHeight: lineHeight ? `${lineHeight}px` : undefined,
    objectFit: "cover",
    objectPosition: "center",
    resizeClass: "",
  };
  node.props.events = {};
  return [id, node];
}

function makeImage(prototype, id, parent, { top, left, width, height, image }) {
  const node = clone(prototype);
  node.parent = parent;
  node.nodes = [];
  node.hidden = false;
  node.props.styleProps = {
    ...node.props.styleProps,
    position: "absolute",
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
    objectFit: "contain",
    objectPosition: "center",
    zIndex: "2",
  };
  node.props.data = {
    ...node.props.data,
    resizable: false,
    imageList: image,
  };
  node.props.events = {};
  return [id, node];
}

function makeHotSpot(prototype, id, parent, { top, left, width, height, link }) {
  const node = clone(prototype);
  node.parent = parent;
  node.nodes = [];
  node.hidden = false;
  node.props.styleProps = {
    ...node.props.styleProps,
    position: "absolute",
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
    zIndex: 998,
  };
  node.props.data = { link: "" };
  node.props.events = {
    actionType: "1",
    actionExt: "0",
    link: clone(link),
  };
  return [id, node];
}

function addNode(tree, entry) {
  const [id, node] = entry;
  if (tree[id]) {
    throw new Error(`Duplicate component id: ${id}`);
  }
  tree[id] = node;
}

function assetLink(userInfo, valuePath) {
  const item = userInfo.props.data.dataSource.find(
    (candidate) => candidate?.link?.valuePath === valuePath,
  );
  if (!item?.link) {
    throw new Error(`PUserInfo does not expose ${valuePath} link`);
  }
  const link = clone(item.link);
  if (link.h5Path) {
    link.path = link.h5Path;
  }
  return link;
}

function internalLink({ key, label, h5Path, id }) {
  return {
    key,
    label,
    miniPath: "",
    h5Path,
    appType: ["3"],
    showType: ["inside"],
    isSupportCopy: true,
    id,
    checked: true,
    path: h5Path,
  };
}

function buildSeeYouOftenHome(homePage) {
  const sourceTree = parseJsonField(homePage.componentsTree, "componentsTree");
  const containerPrototype = findPrototype(sourceTree, "FContainer");
  const textPrototype = findPrototype(sourceTree, "FText");
  const imagePrototype = findPrototype(sourceTree, "FImage");
  const hotSpotPrototype = findPrototype(sourceTree, "FHotSpot");
  const userInfoPrototype = findPrototype(sourceTree, "PUserInfo");
  const navPrototype = findPrototype(sourceTree, "FNav");
  const endPrototype = findPrototype(sourceTree, "FEndPlaceholder");

  const tree = { ROOT: clone(sourceTree.ROOT) };
  tree.ROOT.props.styleProps = {
    ...tree.ROOT.props.styleProps,
    backgroundColor: PALETTE.cream,
  };
  tree.ROOT.props.data = {
    ...tree.ROOT.props.data,
    pageName: "See You Often 会员首页",
    pageNameML: {
      value: "See You Often Membership",
      valueML: {
        en_US: "See You Often Membership",
        zh_CN: "See You Often 会员首页",
        ms_MY: "Keahlian See You Often",
      },
    },
    bgType: 0,
    bgColor: {
      backfillValue: PALETTE.cream,
      backgroundColor: PALETTE.cream,
    },
    images: [],
    images2: [],
    pageImageSwitch: false,
    pageImageUrl: "",
  };

  const nav = clone(navPrototype);
  nav.parent = "ROOT";
  nav.props.data = {
    ...nav.props.data,
    navColor: PALETTE.cream,
    title: "",
  };
  nav.props.styleProps = {
    ...nav.props.styleProps,
    fontFamily: "OPPOSans",
    fontSize: "14px",
  };
  tree.SYO_NAV = nav;

  const heroChildren = [
    "SYO_HERO_LOGO",
    "SYO_HERO_KICKER",
    "SYO_HERO_TITLE_1",
    "SYO_HERO_TITLE_2",
    "SYO_HERO_SUB",
    "SYO_HERO_NOTE",
  ];
  addNode(tree, makeContainer(containerPrototype, "SYO_HERO", "ROOT", {
    width: "375px",
    height: "318px",
    position: "relative",
    overflow: "hidden",
    backgroundColor: PALETTE.flesh,
    borderBottomLeftRadius: "34px",
    borderBottomRightRadius: "34px",
    zIndex: 1,
  }, heroChildren));
  addNode(tree, makeImage(imagePrototype, "SYO_HERO_LOGO", "SYO_HERO", {
    top: 29,
    left: 88,
    width: 52,
    height: 52,
    image: LOGO_URL,
  }));
  addNode(tree, makeText(textPrototype, "SYO_HERO_KICKER", "SYO_HERO", {
    en: "SYO · MEMBERS",
    zh: "SYO · 会员",
    ms: "SYO · AHLI",
    top: 44,
    left: 154,
    width: 110,
    height: 22,
    size: 11,
    color: PALETTE.cocoaDark,
    font: "NeutraTextDemiAlt",
    zhFont: "OPPOSans",
    bold: true,
  }));
  addNode(tree, makeText(textPrototype, "SYO_HERO_TITLE_1", "SYO_HERO", {
    en: "Made for every",
    zh: "常来，常有",
    ms: "Untuk setiap",
    top: 118,
    left: 24,
    width: 320,
    height: 43,
    size: 34,
    color: PALETTE.cocoaDark,
    font: "NeutraTextDemiAlt",
    bold: true,
  }));
  addNode(tree, makeText(textPrototype, "SYO_HERO_TITLE_2", "SYO_HERO", {
    en: "everyday craving.",
    zh: "好事发生。",
    ms: "selera harian.",
    top: 161,
    left: 24,
    width: 320,
    height: 43,
    size: 34,
    color: PALETTE.cocoaDark,
    font: "NeutraTextDemiAlt",
    bold: true,
  }));
  addNode(tree, makeText(textPrototype, "SYO_HERO_SUB", "SYO_HERO", {
    en: "Rewards, balance and little treats — in one account.",
    zh: "优惠券、储值、积分与小惊喜，都在同一个账户。",
    ms: "Kupon, baki dan mata — semua dalam satu akaun.",
    top: 225,
    left: 24,
    width: 316,
    height: 46,
    size: 14,
    color: PALETTE.cocoaDark,
    font: "OPPOSans",
    zhFont: "OPPOSans",
    lineHeight: 22,
  }));
  addNode(tree, makeText(textPrototype, "SYO_HERO_NOTE", "SYO_HERO", {
    en: "ONE QR · ONE MEMBER ACCOUNT",
    zh: "一个二维码 · 一个会员账户",
    ms: "SATU KOD QR · SATU AKAUN AHLI",
    top: 286,
    left: 24,
    width: 270,
    height: 18,
    size: 10,
    color: PALETTE.cocoa,
    font: "NeutraTextDemiAlt",
    zhFont: "OPPOSans",
    bold: true,
  }));

  const userInfo = clone(userInfoPrototype);
  userInfo.parent = "ROOT";
  userInfo.props.styleProps = {
    ...userInfo.props.styleProps,
    marginTop: "-28px",
    marginBottom: "18px",
    marginLeft: "16px",
    marginRight: "16px",
    borderTopLeftRadius: "18px",
    borderTopRightRadius: "18px",
    borderBottomLeftRadius: "18px",
    borderBottomRightRadius: "18px",
    backgroundColor: PALETTE.white,
    zIndex: 4,
    boxShadow: "0 12px 30px rgba(89,35,27,0.12)",
  };
  userInfo.props.data = {
    ...userInfo.props.data,
    nickname: {
      value: "又见面了，亲爱的朋友",
      valueML: {
        en_US: "Good to see you again",
        zh_CN: "又见面了，亲爱的朋友",
        ms_MY: "Gembira jumpa lagi",
      },
    },
    tagBgColor: PALETTE.pistachio,
    levelTextColor: PALETTE.cocoaDark,
    lightProgressColor: PALETTE.pistachio,
    darkProgressColor: PALETTE.cream,
    progressTextColor: PALETTE.cocoaDark,
    loginBtnBgText: {
      value: "登录 / 注册 · 领取 RM10",
      valueML: {
        en_US: "Join / Log in · Get RM10",
        zh_CN: "登录 / 注册 · 领取 RM10",
        ms_MY: "Daftar / Log masuk · Dapat RM10",
      },
    },
    loginBtnBgColor: PALETTE.pistachio,
    assetColor: PALETTE.cocoaDark,
    numberColor: PALETTE.cocoaDark,
  };
  userInfo.props.data.loginBtnTextStyle = {
    ...userInfo.props.data.loginBtnTextStyle,
    fontColor: PALETTE.cocoaDark,
    fontWeight: "bold",
  };
  userInfo.props.data.nicknameStyle = {
    ...userInfo.props.data.nicknameStyle,
    fontColor: PALETTE.cocoaDark,
  };
  userInfo.props.data.assetNumberStyle = {
    ...userInfo.props.data.assetNumberStyle,
    fontColor: PALETTE.cocoaDark,
  };
  userInfo.props.data.assetNameStyle = {
    ...userInfo.props.data.assetNameStyle,
    fontColor: PALETTE.cocoaDark,
  };
  for (const item of userInfo.props.data.dataSource) {
    const translations = {
      couponNum: { en_US: "Coupons", zh_CN: "优惠券", ms_MY: "Kupon" },
      balance: { en_US: "Balance", zh_CN: "储值", ms_MY: "Baki" },
      points: { en_US: "Points", zh_CN: "积分", ms_MY: "Mata" },
    }[item?.link?.valuePath];
    if (translations) {
      item.label.value = translations.zh_CN;
      item.label.valueML = translations;
    }
  }
  tree.SYO_MEMBER = userInfo;

  const actionCards = [
    {
      id: "QUICK_ORDER",
      x: 0,
      y: 58,
      color: PALETTE.pistachio,
      number: "01",
      en: "Order now",
      zh: "立即点单",
      ms: "Pesan sekarang",
      link: internalLink({
        key: "preOrder",
        label: "预点餐",
        h5Path: "/selectStore?bizType=1100&fun=1",
        id: 858,
      }),
    },
    {
      id: "COUPON",
      x: 175,
      y: 58,
      color: PALETTE.blush,
      number: "02",
      en: "My coupons",
      zh: "我的优惠券",
      ms: "Kupon saya",
      link: assetLink(userInfo, "couponNum"),
    },
    {
      id: "QUICK_TOPUP",
      x: 0,
      y: 151,
      color: PALETTE.walnut,
      number: "03",
      en: "Top up",
      zh: "会员储值",
      ms: "Tambah nilai",
      link: assetLink(userInfo, "balance"),
    },
    {
      id: "POINTS",
      x: 175,
      y: 151,
      color: PALETTE.tan,
      number: "04",
      en: "My points",
      zh: "我的积分",
      ms: "Mata saya",
      link: assetLink(userInfo, "points"),
    },
  ];
  const actionChildren = ["SYO_ACTIONS_TITLE"];
  for (const card of actionCards) {
    actionChildren.push(
      `SYO_${card.id}_NUMBER`,
      `SYO_${card.id}_LABEL`,
      `SYO_${card.id}_LINK`,
    );
  }
  addNode(tree, makeContainer(containerPrototype, "SYO_ACTIONS", "ROOT", {
    width: "343px",
    height: "254px",
    position: "relative",
    overflow: "hidden",
    marginLeft: "16px",
    marginRight: "16px",
    marginBottom: "18px",
    backgroundColor: PALETTE.white,
    borderTopLeftRadius: "22px",
    borderTopRightRadius: "22px",
    borderBottomRightRadius: "22px",
    borderBottomLeftRadius: "22px",
    border: `1px solid ${PALETTE.tan}`,
  }, actionChildren));
  addNode(tree, makeText(textPrototype, "SYO_ACTIONS_TITLE", "SYO_ACTIONS", {
    en: "Everything in one place",
    zh: "会员常用，一页直达",
    ms: "Semua di satu tempat",
    top: 20,
    left: 20,
    width: 300,
    height: 34,
    size: 24,
    color: PALETTE.cocoaDark,
    font: "NeutraTextDemiAlt",
    bold: true,
  }));
  for (const card of actionCards) {
    const cardId = `SYO_${card.id}`;
    addNode(tree, makeText(textPrototype, `${cardId}_NUMBER`, "SYO_ACTIONS", {
      en: card.number,
      zh: card.number,
      ms: card.number,
      top: card.y + 13,
      left: card.x + 20,
      width: 35,
      height: 16,
      size: 10,
      color: PALETTE.cocoa,
      font: "NeutraTextDemiAlt",
      zhFont: "OPPOSans",
      bold: true,
    }));
    addNode(tree, makeText(textPrototype, `${cardId}_LABEL`, "SYO_ACTIONS", {
      en: card.en,
      zh: card.zh,
      ms: card.ms,
      top: card.y + 40,
      left: card.x + 20,
      width: 145,
      height: 26,
      size: 17,
      color: PALETTE.cocoaDark,
      font: "NeutraTextDemiAlt",
      bold: true,
    }));
    addNode(tree, makeHotSpot(hotSpotPrototype, `${cardId}_LINK`, "SYO_ACTIONS", {
      top: card.y,
      left: card.x,
      width: 170,
      height: 84,
      link: card.link,
    }));
  }

  const rewardChildren = [
    "SYO_REWARD_KICKER",
    "SYO_REWARD_TITLE",
    "SYO_REWARD_SUB",
    "SYO_REWARD_STEP_1",
    "SYO_REWARD_STEP_2",
    "SYO_REWARD_STEP_3",
    "SYO_REWARD_LINK",
  ];
  addNode(tree, makeContainer(containerPrototype, "SYO_REWARD", "ROOT", {
    width: "343px",
    height: "224px",
    position: "relative",
    overflow: "hidden",
    marginLeft: "16px",
    marginRight: "16px",
    marginBottom: "18px",
    backgroundColor: PALETTE.flesh,
    borderTopLeftRadius: "22px",
    borderTopRightRadius: "22px",
    borderBottomRightRadius: "22px",
    borderBottomLeftRadius: "22px",
  }, rewardChildren));
  addNode(tree, makeText(textPrototype, "SYO_REWARD_KICKER", "SYO_REWARD", {
    en: "WELCOME REWARD",
    zh: "新会员见面礼",
    ms: "GANJARAN SELAMAT DATANG",
    top: 22,
    left: 20,
    width: 180,
    height: 18,
    size: 10,
    color: PALETTE.cocoaDark,
    font: "NeutraTextDemiAlt",
    zhFont: "OPPOSans",
    bold: true,
  }));
  addNode(tree, makeText(textPrototype, "SYO_REWARD_TITLE", "SYO_REWARD", {
    en: "Complete profile. Get RM10.",
    zh: "完善资料，RM10 自动到账。",
    ms: "Lengkapkan profil. Dapat RM10.",
    top: 50,
    left: 20,
    width: 300,
    height: 32,
    size: 22,
    color: PALETTE.cocoaDark,
    font: "NeutraTextDemiAlt",
    bold: true,
  }));
  addNode(tree, makeText(textPrototype, "SYO_REWARD_SUB", "SYO_REWARD", {
    en: "No second account. Complete your profile here →",
    zh: "不需要第二个账户，点这里完善资料 →",
    ms: "Tiada akaun kedua. Lengkapkan profil di sini →",
    top: 89,
    left: 20,
    width: 300,
    height: 22,
    size: 12,
    color: PALETTE.cocoaDark,
    font: "OPPOSans",
    zhFont: "OPPOSans",
  }));
  const steps = [
    ["SYO_REWARD_STEP_1", "01  Verify your mobile", "01  验证手机号", "01  Sahkan nombor telefon", 132],
    ["SYO_REWARD_STEP_2", "02  Add name & birthday", "02  补充姓名与生日", "02  Tambah nama & tarikh lahir", 161],
    ["SYO_REWARD_STEP_3", "03  Coupon arrives in account", "03  优惠券自动到账", "03  Kupon masuk ke akaun", 190],
  ];
  for (const [id, en, zh, ms, top] of steps) {
    addNode(tree, makeText(textPrototype, id, "SYO_REWARD", {
      en,
      zh,
      ms,
      top,
      left: 20,
      width: 295,
      height: 20,
      size: 12,
      color: PALETTE.cocoaDark,
      font: "OPPOSans",
      zhFont: "OPPOSans",
      bold: true,
    }));
  }
  addNode(tree, makeHotSpot(hotSpotPrototype, "SYO_REWARD_LINK", "SYO_REWARD", {
    top: 0,
    left: 0,
    width: 343,
    height: 224,
    link: {
      key: "userInfo",
      label: "个人资料",
      miniPath: "/subPackages/member/userInfo/index",
      h5Path: "/editUserInfo",
      appType: ["0", "1", "2", "3", "9"],
      showType: ["inside"],
      isSupportCopy: true,
      isGoShareIndex: true,
      loginType: "1",
      checked: true,
      path: "/editUserInfo",
    },
  }));

  const topupLink = assetLink(userInfo, "balance");
  const topupChildren = [
    "SYO_TOPUP_KICKER",
    "SYO_TOPUP_VALUE",
    "SYO_TOPUP_COPY",
    "SYO_TOPUP_CTA",
    "SYO_TOPUP_LINK",
  ];
  addNode(tree, makeContainer(containerPrototype, "SYO_TOPUP", "ROOT", {
    width: "343px",
    height: "192px",
    position: "relative",
    overflow: "hidden",
    marginLeft: "16px",
    marginRight: "16px",
    marginBottom: "18px",
    backgroundColor: PALETTE.pistachio,
    borderTopLeftRadius: "22px",
    borderTopRightRadius: "22px",
    borderBottomRightRadius: "22px",
    borderBottomLeftRadius: "22px",
  }, topupChildren));
  addNode(tree, makeText(textPrototype, "SYO_TOPUP_KICKER", "SYO_TOPUP", {
    en: "EVERYDAY STORED VALUE",
    zh: "日常储值",
    ms: "NILAI TERSIMPAN HARIAN",
    top: 22,
    left: 20,
    width: 200,
    height: 18,
    size: 10,
    color: PALETTE.cocoaDark,
    font: "NeutraTextDemiAlt",
    zhFont: "OPPOSans",
    bold: true,
  }));
  addNode(tree, makeText(textPrototype, "SYO_TOPUP_VALUE", "SYO_TOPUP", {
    en: "RM100 + RM20",
    zh: "储 RM100 · 得 RM20",
    ms: "Tambah RM100 · Dapat RM20",
    top: 50,
    left: 20,
    width: 300,
    height: 42,
    size: 30,
    color: PALETTE.cocoaDark,
    font: "NeutraTextDemiAlt",
    bold: true,
  }));
  addNode(tree, makeText(textPrototype, "SYO_TOPUP_COPY", "SYO_TOPUP", {
    en: "Top up once. Make every visit effortless.",
    zh: "一次储值，让每次见面都更轻松。",
    ms: "Tambah nilai sekali. Setiap kunjungan lebih mudah.",
    top: 103,
    left: 20,
    width: 295,
    height: 24,
    size: 13,
    color: PALETTE.cocoaDark,
    font: "OPPOSans",
    zhFont: "OPPOSans",
  }));
  addNode(tree, makeText(textPrototype, "SYO_TOPUP_CTA", "SYO_TOPUP", {
    en: "TOP UP NOW  →",
    zh: "立即储值  →",
    ms: "TAMBAH NILAI  →",
    top: 150,
    left: 20,
    width: 190,
    height: 22,
    size: 13,
    color: PALETTE.cocoaDark,
    font: "NeutraTextDemiAlt",
    zhFont: "OPPOSans",
    bold: true,
  }));
  addNode(tree, makeHotSpot(hotSpotPrototype, "SYO_TOPUP_LINK", "SYO_TOPUP", {
    top: 0,
    left: 0,
    width: 343,
    height: 192,
    link: topupLink,
  }));

  const orderLink = internalLink({
    key: "preOrder",
    label: "预点餐",
    h5Path: "/selectStore?bizType=1100&fun=1",
    id: 858,
  });
  const orderChildren = ["SYO_ORDER_TITLE", "SYO_ORDER_SUB", "SYO_ORDER_LINK"];
  addNode(tree, makeContainer(containerPrototype, "SYO_ORDER", "ROOT", {
    width: "343px",
    height: "94px",
    position: "relative",
    overflow: "hidden",
    marginLeft: "16px",
    marginRight: "16px",
    marginBottom: "26px",
    backgroundColor: PALETTE.white,
    borderTopLeftRadius: "18px",
    borderTopRightRadius: "18px",
    borderBottomRightRadius: "18px",
    borderBottomLeftRadius: "18px",
    border: `1px solid ${PALETTE.tan}`,
  }, orderChildren));
  addNode(tree, makeText(textPrototype, "SYO_ORDER_TITLE", "SYO_ORDER", {
    en: "Ready for something good?",
    zh: "今天，想吃点什么？",
    ms: "Nak makan apa hari ini?",
    top: 19,
    left: 18,
    width: 245,
    height: 28,
    size: 19,
    color: PALETTE.cocoaDark,
    font: "NeutraTextDemiAlt",
    bold: true,
  }));
  addNode(tree, makeText(textPrototype, "SYO_ORDER_SUB", "SYO_ORDER", {
    en: "ORDER NOW  →",
    zh: "立即点单  →",
    ms: "PESAN SEKARANG  →",
    top: 57,
    left: 18,
    width: 170,
    height: 18,
    size: 11,
    color: PALETTE.cocoa,
    font: "NeutraTextDemiAlt",
    zhFont: "OPPOSans",
    bold: true,
  }));
  addNode(tree, makeHotSpot(hotSpotPrototype, "SYO_ORDER_LINK", "SYO_ORDER", {
    top: 0,
    left: 0,
    width: 343,
    height: 94,
    link: orderLink,
  }));

  const end = clone(endPrototype);
  end.parent = "ROOT";
  tree.SYO_END = end;

  tree.ROOT.nodes = [
    "SYO_HERO",
    "SYO_MEMBER",
    "SYO_ACTIONS",
    "SYO_REWARD",
    "SYO_TOPUP",
    "SYO_ORDER",
    "SYO_END",
    "SYO_NAV",
  ];

  const designed = {
    ...clone(homePage),
    pageName: "See You Often 会员首页",
    pageNameML: {
      en_US: "See You Often Membership",
      zh_CN: "See You Often 会员首页",
      ms_MY: "Keahlian See You Often",
    },
    componentsTree: JSON.stringify(tree),
    componentsMap: "{}",
    thumbnailUrl: "",
  };

  validateComponentTree(tree);
  return designed;
}

function validateComponentTree(tree) {
  if (!tree?.ROOT || tree.ROOT.parent !== null) {
    throw new Error("Component tree must contain a root node with parent null");
  }

  const visited = new Set();
  const walk = (id) => {
    if (visited.has(id)) {
      throw new Error(`Component tree contains a cycle or duplicate child: ${id}`);
    }
    const node = tree[id];
    if (!node) {
      throw new Error(`Component tree references missing node: ${id}`);
    }
    visited.add(id);
    for (const childId of node.nodes || []) {
      const child = tree[childId];
      if (!child) {
        throw new Error(`Component tree references missing child: ${childId}`);
      }
      if (child.parent !== id) {
        throw new Error(`Parent mismatch for ${childId}: ${child.parent} !== ${id}`);
      }
      walk(childId);
    }
  };
  walk("ROOT");

  const orphanIds = Object.keys(tree).filter((id) => !visited.has(id));
  if (orphanIds.length) {
    throw new Error(`Component tree contains orphan nodes: ${orphanIds.join(", ")}`);
  }
  return true;
}

export {
  PALETTE,
  buildSeeYouOftenHome,
  parseJsonField,
  validateComponentTree,
};
