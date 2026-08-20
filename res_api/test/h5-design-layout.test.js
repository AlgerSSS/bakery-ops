import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHbtiOpenScreen,
  buildSeeYouOftenHome,
  parseJsonField,
  validateComponentTree,
} from "../lib/h5-design-layout.mjs";

function sourceHomePage() {
  const component = (name, parent = "ROOT") => ({
    type: { resolvedName: name },
    isCanvas: name === "FContainer",
    props: {
      styleProps: {},
      data: {},
      events: {},
    },
    displayName: name,
    parent,
    hidden: false,
    nodes: [],
    linkedNodes: {},
  });
  const userInfo = component("PUserInfo");
  userInfo.props.data = {
    dataSource: [
      {
        label: { value: "优惠券", valueML: { zh_CN: "优惠券" } },
        link: {
          valuePath: "couponNum",
          h5Path: "/couponIndex",
          path: "/couponIndex",
          checked: true,
        },
      },
      {
        label: { value: "余额", valueML: { zh_CN: "余额" } },
        link: {
          valuePath: "balance",
          h5Path: "/cardRecharge",
          path: "/cardRecharge",
          checked: true,
        },
      },
      {
        label: { value: "积分", valueML: { zh_CN: "积分" } },
        link: {
          valuePath: "points",
          h5Path: "/currentBalance",
          path: "/currentBalance",
          checked: true,
        },
      },
    ],
    loginBtnTextStyle: {},
    nicknameStyle: {},
    assetNumberStyle: {},
    assetNameStyle: {},
  };
  const swiper = component("FSwiper");
  swiper.isCanvas = true;
  swiper.props.data = {
    images: [
      { icon: "//img.example.com/poster-1.jpg", index: 0, link: {} },
      { icon: "//img.example.com/poster-2.jpg", index: 1, link: {} },
    ],
    images2: [],
    swiperStyle: 0,
    swiperType: "1",
    swiperTime: 5,
  };
  swiper.props.styleProps = {
    width: "375px",
    height: "520px",
    objectFit: "cover",
  };
  return {
    decorationPageId: "home",
    decorationPlanId: "formal",
    pageName: "首页",
    pageType: "homePage",
    pageData: "",
    componentsTree: JSON.stringify({
      ROOT: {
        ...component("Container", null),
        props: {
          styleProps: {},
          data: {},
          events: {},
        },
      },
      CONTAINER: component("FContainer"),
      TEXT: component("FText"),
      IMAGE: component("FImage"),
      HOTSPOT: component("FHotSpot"),
      SWIPER: swiper,
      USER: userInfo,
      NAV: component("FNav"),
      END: component("FEndPlaceholder"),
    }),
    componentsMap: "{}",
    homePage: true,
  };
}

test("builds a valid See You Often RES H5 home page", async () => {
  const source = sourceHomePage();
  const designed = buildSeeYouOftenHome(source);
  const tree = parseJsonField(designed.componentsTree, "componentsTree");

  assert.equal(designed.pageName, "See You Often 会员首页");
  assert.equal(designed.pageNameML.ms_MY, "Keahlian See You Often");
  assert.equal(tree.ROOT.props.styleProps.backgroundColor, "#F9F2E3");
  assert.deepEqual(tree.ROOT.nodes, [
    "SYO_POSTERS",
    "SYO_HERO",
    "SYO_MEMBER",
    "SYO_ACTIONS",
    "SYO_TOPUP",
    "SYO_ORDER",
    "SYO_END",
    "SYO_NAV",
  ]);
  assert.equal(tree.SYO_POSTERS.type.resolvedName, "FSwiper");
  assert.deepEqual(
    tree.SYO_POSTERS.props.data.images.map(({ icon }) => icon),
    ["//img.example.com/poster-1.jpg", "//img.example.com/poster-2.jpg"],
  );
  assert.equal(tree.SYO_POSTERS.props.data.swiperTime, 3);
  assert.equal(tree.SYO_POSTERS.props.styleProps.height, "220px");
  assert.equal(tree.SYO_MEMBER.type.resolvedName, "PUserInfo");
  assert.equal(tree.SYO_HERO_ORB, undefined);
  assert.equal(tree.SYO_HERO.nodes.includes("SYO_HERO_ORB"), false);
  const expectedLinks = {
    SYO_QUICK_ORDER_LINK: "/selectStore?bizType=1100&fun=1",
    SYO_COUPON_LINK: "/couponIndex",
    SYO_QUICK_TOPUP_LINK: "/cardRecharge",
    SYO_POINTS_LINK: "/currentBalance",
    SYO_TOPUP_LINK: "/cardRecharge",
    SYO_ORDER_LINK: "/selectStore?bizType=1100&fun=1",
  };
  for (const [id, h5Path] of Object.entries(expectedLinks)) {
    assert.equal(tree[id].type.resolvedName, "FHotSpot");
    assert.equal(tree[id].props.events.link.h5Path, h5Path);
    assert.equal(tree[id].props.events.link.path, h5Path);
    assert.equal(tree[id].props.events.link.checked, true);
  }
  const hotSpots = Object.values(tree).filter(
    (node) => node.type?.resolvedName === "FHotSpot",
  );
  assert.equal(hotSpots.length, Object.keys(expectedLinks).length);
  const textNodes = Object.values(tree).filter(
    (node) => node.type?.resolvedName === "FText",
  );
  assert.equal(textNodes.length, 20);
  for (const node of textNodes) {
    assert.ok(node.props.data.fText.valueML.en_US);
    assert.ok(node.props.data.fText.valueML.zh_CN);
    assert.ok(node.props.data.fText.valueML.ms_MY);
    assert.ok(node.props.data.fText.extML.ms_MY);
  }
  assert.equal(
    tree.SYO_MEMBER.props.data.nickname.valueML.ms_MY,
    "Gembira jumpa lagi",
  );
  assert.equal(tree.SYO_MEMBER.props.data.loginBtnBgText.valueML.zh_CN, "登录 / 注册");
  const visibleCopy = textNodes
    .flatMap((node) => Object.values(node.props.data.fText.valueML))
    .concat(Object.values(tree.SYO_MEMBER.props.data.loginBtnBgText.valueML));
  assert.equal(visibleCopy.some((value) => /\bRM10\b/.test(value)), false);
  for (const item of tree.SYO_MEMBER.props.data.dataSource) {
    assert.ok(item.label.valueML.ms_MY);
  }
  assert.equal(validateComponentTree(tree), true);
});

test("builds an HBTI open-screen popup with a safe external link", () => {
  const openScreenPage = {
    decorationPageId: "open-screen",
    pageType: "POpenScreenPage",
    componentsTree: JSON.stringify({
      ROOT: {
        type: { resolvedName: "Container" },
        parent: null,
        nodes: ["OPEN_SCREEN"],
        props: { styleProps: {}, data: {}, events: {} },
      },
      OPEN_SCREEN: {
        type: { resolvedName: "POpenScreenPage" },
        parent: "ROOT",
        nodes: [],
        props: {
          data: {
            setting: {
              open: true,
              adUrl: "//img.example.com/old.png",
              showTime: 1,
              longTime: 3,
              frequency: 2,
              link: {},
            },
          },
          styleProps: {},
          events: {},
        },
      },
    }),
    componentsMap: "{}",
  };

  const designed = buildHbtiOpenScreen(openScreenPage, {
    imageUrl: "//img.sea.restosuite.ai/image/hbti-popup.png",
    href: "https://hbti-test.hotcrush.net/",
  });
  const tree = parseJsonField(designed.componentsTree, "componentsTree");
  const setting = tree.OPEN_SCREEN.props.data.setting;

  assert.equal(setting.open, true);
  assert.equal(setting.adUrl, "//img.sea.restosuite.ai/image/hbti-popup.png");
  assert.equal(setting.showTime, 1);
  assert.equal(setting.longTime, 3);
  assert.equal(setting.frequency, 2);
  assert.deepEqual(setting.link, {
    key: "customPageUrl",
    id: "100",
    label: "自定义页面路径",
    miniPath: "",
    h5Path: "",
    appType: ["0", "1", "2", "3", "9"],
    isCustomLink: true,
    outLink: true,
    modalType: "customeLink",
    showType: ["inside"],
    path: "https://hbti-test.hotcrush.net/",
    checked: true,
  });
  assert.equal(validateComponentTree(tree), true);
});

test("rejects an insecure HBTI popup target", () => {
  const openScreenPage = {
    componentsTree: JSON.stringify({
      ROOT: { parent: null, nodes: ["OPEN_SCREEN"] },
      OPEN_SCREEN: {
        type: { resolvedName: "POpenScreenPage" },
        parent: "ROOT",
        nodes: [],
        props: { data: { setting: {} } },
      },
    }),
  };
  assert.throws(
    () => buildHbtiOpenScreen(openScreenPage, {
      imageUrl: "//img.sea.restosuite.ai/image/hbti-popup.png",
      href: "http://hbti-test.hotcrush.net/",
    }),
    /HTTPS/,
  );
});

test("rejects orphan components", () => {
  const tree = {
    ROOT: { parent: null, nodes: [] },
    ORPHAN: { parent: "ROOT", nodes: [] },
  };
  assert.throws(
    () => validateComponentTree(tree),
    /orphan nodes: ORPHAN/,
  );
});
