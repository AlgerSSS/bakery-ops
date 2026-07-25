import { NextRequest, NextResponse } from "next/server";
import { generateDailyReview } from "@/modules/domain/forecast/daily-review.service";

export async function POST(req: NextRequest) {
  try {
    const { feedData } = await req.json();
    if (!feedData || !feedData.date) {
      return NextResponse.json({ error: "缺少 feedData 参数" }, { status: 400 });
    }

    const { review, tomorrowSuggestions } = await generateDailyReview(feedData);
    return NextResponse.json({ review, tomorrowSuggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("AI 返回")) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    console.error("Daily review error:", error);
    return NextResponse.json({ error: `AI 调用失败: ${message}` }, { status: 500 });
  }
}
