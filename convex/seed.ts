import { internalMutation } from "./_generated/server";
import { todayUtc } from "./lib/rules";

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Local demo data: `npx convex run seed:demo`. Internal, so no client can call it.
// Includes one overdue loan so the n8n reminder workflow has something to do.
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query("tools").first()) return "already seeded";
    const user = (n: number, name: string) =>
      ctx.db.insert("users", { tokenIdentifier: `demo|${n}`, clerkUserId: `demo_${n}`, name, role: "user", trusted: n === 1 });
    const [rosa, tom] = [await user(1, "Rosa"), await user(2, "Tom")];
    const tool = (ownerId: typeof rosa, name: string, category: "power-tools" | "garden" | "camping" | "kitchen", description: string) =>
      ctx.db.insert("tools", { ownerId, name, category, condition: "good", description, removed: false });
    const drill = await tool(rosa, "Cordless drill", "power-tools", "18V, two batteries and a bit set.");
    await tool(rosa, "Hedge trimmer", "garden", "Electric, 50 cm blade.");
    await tool(tom, "Two-person tent", "camping", "Packs small, rain fly included.");
    await tool(tom, "Stand mixer", "kitchen", "Dough hook and whisk.");
    const today = todayUtc();
    await ctx.db.insert("loans", {
      toolId: drill,
      toolName: "Cordless drill",
      ownerId: rosa,
      borrowerId: tom,
      startDate: addDays(today, -6),
      endDate: addDays(today, -2),
      status: "approved",
    });
    return "seeded";
  },
});
