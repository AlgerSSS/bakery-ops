"""
KL influencer scraper — resumable.
Run: MS_TOKEN=<token> python kl_influencers.py

Progress is saved to:
  kl_candidates.json  — authors found from hashtags
  kl_influencers.json — authors with >500k followers (with sec_uid)
  kl_results.json     — final video view counts

Delete a file to re-run that phase.
"""
import asyncio
import json
import os
from TikTokApi import TikTokApi

HASHTAGS = ["kualalumpur", "kl", "malaysia", "klang"]
FOLLOWER_THRESHOLD = 500_000
VIDEOS_PER_HASHTAG = 50
VIDEOS_PER_USER = 20

MS_TOKEN = os.environ.get("MS_TOKEN", "")

def make_api_kwargs():
    kw = dict(
        num_sessions=1,
        sleep_after=3,
        headless=False,
        browser="chromium",
        timeout=60000,
        allow_partial_sessions=True,
        suppress_resource_load_types=["image", "media", "font"],
    )
    if MS_TOKEN:
        kw["ms_tokens"] = [MS_TOKEN]
    return kw

def load_json(path, default):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# ── Phase 1: collect authors from hashtags ──────────────────────────────────

async def phase1_collect_authors():
    candidates = load_json("kl_candidates.json", None)
    if candidates is not None:
        print(f"[phase1] loaded {len(candidates)} authors from kl_candidates.json, skipping.")
        return candidates

    seen = set()
    candidates = []

    async with TikTokApi() as api:
        await api.create_sessions(**make_api_kwargs())
        for tag in HASHTAGS:
            print(f"  #{tag}...")
            try:
                async for video in api.hashtag(name=tag).videos(count=VIDEOS_PER_HASHTAG):
                    uname = video.author.username
                    if uname and uname not in seen:
                        seen.add(uname)
                        candidates.append(uname)
                    await asyncio.sleep(0.5)
            except Exception as e:
                print(f"    error: {e}")
            await asyncio.sleep(3)

    save_json("kl_candidates.json", candidates)
    print(f"[phase1] found {len(candidates)} authors, saved to kl_candidates.json")
    return candidates

# ── Phase 2: filter by follower count ───────────────────────────────────────

async def phase2_filter_influencers(candidates):
    influencers = load_json("kl_influencers.json", None)
    if influencers is not None:
        print(f"[phase2] loaded {len(influencers)} influencers from kl_influencers.json, skipping.")
        return influencers

    # load partial progress if exists
    done_users = load_json("kl_influencers_progress.json", {})
    remaining = [u for u in candidates if u not in done_users]
    print(f"[phase2] checking {len(remaining)} users (already done: {len(done_users)})...")

    async with TikTokApi() as api:
        await api.create_sessions(**make_api_kwargs())
        for uname in remaining:
            try:
                info = await api.user(username=uname).info()
                user_data = info.get("userInfo", {}).get("user", {})
                stats = info.get("userInfo", {}).get("stats", {})
                followers = stats.get("followerCount", 0)
                sec_uid = user_data.get("secUid", "")
                user_id = user_data.get("id", "")
                done_users[uname] = {
                    "followers": followers,
                    "sec_uid": sec_uid,
                    "user_id": user_id,
                }
                mark = "OK" if followers >= FOLLOWER_THRESHOLD else "--"
                print(f"  {mark} @{uname} -- {followers:,}")
            except Exception as e:
                print(f"  error @{uname}: {e}")
            save_json("kl_influencers_progress.json", done_users)
            await asyncio.sleep(2)

    influencers = [
        {"username": u, **v}
        for u, v in done_users.items()
        if v.get("followers", 0) >= FOLLOWER_THRESHOLD and v.get("sec_uid")
    ]
    save_json("kl_influencers.json", influencers)
    print(f"[phase2] {len(influencers)} influencers with >{FOLLOWER_THRESHOLD:,} followers")
    return influencers

# ── Phase 3: fetch videos ────────────────────────────────────────────────────

async def phase3_fetch_videos(influencers):
    results = load_json("kl_results.json", {})
    remaining = [inf for inf in influencers if inf["username"] not in results]
    if not remaining:
        print(f"[phase3] all {len(results)} influencers already done.")
        return results

    print(f"[phase3] fetching videos for {len(remaining)} influencers...")

    async with TikTokApi() as api:
        await api.create_sessions(**make_api_kwargs())
        for inf in remaining:
            uname = inf["username"]
            followers = inf["followers"]
            user_id = inf["user_id"]
            sec_uid = inf["sec_uid"]
            print(f"\n  @{uname} ({followers:,} followers)")
            videos = []
            try:
                async for video in api.user(username=uname, user_id=user_id, sec_uid=sec_uid).videos(count=VIDEOS_PER_USER):
                    d = video.as_dict
                    stats = d.get("stats", {})
                    entry = {
                        "id": video.id,
                        "desc": d.get("desc", "")[:80],
                        "views": stats.get("playCount", 0),
                        "likes": stats.get("diggCount", 0),
                        "shares": stats.get("shareCount", 0),
                    }
                    videos.append(entry)
                    print(f"    {video.id} | views={entry['views']:,} | {entry['desc'][:50]}")
                    await asyncio.sleep(0.5)
            except Exception as e:
                print(f"    error: {e}")
            results[uname] = {"followers": followers, "videos": videos}
            save_json("kl_results.json", results)
            await asyncio.sleep(3)

    return results

# ── Main ─────────────────────────────────────────────────────────────────────

async def main():
    if MS_TOKEN:
        print(f"ms_token: {MS_TOKEN[:20]}...")
    else:
        print("WARNING: no MS_TOKEN set")

    candidates = await phase1_collect_authors()
    influencers = await phase2_filter_influencers(candidates)
    results = await phase3_fetch_videos(influencers)

    total_videos = sum(len(v["videos"]) for v in results.values())
    print(f"\n=== Done ===")
    print(f"Influencers: {len(results)}, Total videos: {total_videos}")
    for uname, data in results.items():
        print(f"\n@{uname} ({data['followers']:,} followers)")
        for v in data["videos"]:
            print(f"  {v['id']} | views={v['views']:,} | {v['desc'][:60]}")

asyncio.run(main())
