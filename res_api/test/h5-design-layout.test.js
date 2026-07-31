import assert from "node:assert/strict";
import test from "node:test";

import {
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
    "SYO_HERO",
    "SYO_MEMBER",
    "SYO_ACTIONS",
    "SYO_REWARD",
    "SYO_TOPUP",
    "SYO_ORDER",
    "SYO_END",
    "SYO_NAV",
  ]);
  assert.equal(tree.SYO_MEMBER.type.resolvedName, "PUserInfo");
  assert.equal(tree.SYO_HERO_ORB, undefined);
  assert.equal(tree.SYO_HERO.nodes.includes("SYO_HERO_ORB"), false);
  const expectedLinks = {
    SYO_QUICK_ORDER_LINK: "/selectStore?bizType=1100&fun=1",
    SYO_COUPON_LINK: "/couponIndex",
    SYO_QUICK_TOPUP_LINK: "/cardRecharge",
    SYO_POINTS_LINK: "/currentBalance",
    SYO_REWARD_LINK: "/editUserInfo",
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
  assert.equal(tree.SYO_REWARD_LINK.props.events.link.loginType, "1");
  assert.equal(tree.SYO_REWARD_LINK.props.events.link.isGoShareIndex, true);
  const textNodes = Object.values(tree).filter(
    (node) => node.type?.resolvedName === "FText",
  );
  assert.equal(textNodes.length, 26);
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
  assert.equal(
    tree.SYO_MEMBER.props.data.loginBtnBgText.valueML.ms_MY,
    "Daftar / Log masuk · Dapat RM10",
  );
  for (const item of tree.SYO_MEMBER.props.data.dataSource) {
    assert.ok(item.label.valueML.ms_MY);
  }
  assert.equal(validateComponentTree(tree), true);
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
