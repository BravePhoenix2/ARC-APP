// Shared display rules. Awarding points is always performed by the server.
export const TESTER_POINT_RULES = [
  { kind: "SIGN_IN", label: "Join the testnet", points: 10, description: "Verify an email address or sign in with your wallet." },
  { kind: "APPROVED_CREATOR", label: "Become an approved creator", points: 25, description: "Have your first art or NFT application reviewed and approved." },
  { kind: "DEPLOY_COLLECTION", label: "Deploy a collection", points: 20, description: "Create your first collection through the Artiq factory on Arc Testnet." },
  { kind: "MINT_NFT", label: "Mint an NFT", points: 30, description: "Complete your first mint from an approved Artiq collection." },
  { kind: "BUY_ART", label: "Buy original art", points: 40, description: "Complete your first purchase through Artiq Art checkout." },
  { kind: "PLACE_BID", label: "Place an auction bid", points: 15, description: "Place your first confirmed bid in an Artiq auction." },
  { kind: "JOIN_REWARD", label: "Join a reward round", points: 10, description: "Join your first eligible Artiq reward round." },
  { kind: "CLAIM_REWARD", label: "Claim a testnet reward", points: 15, description: "Claim your first reward after the round ends." },
] as const;

export const TESTER_MILESTONES = TESTER_POINT_RULES;
export type TesterMilestoneKind = typeof TESTER_POINT_RULES[number]["kind"];
export const MAX_TESTER_POINTS = TESTER_POINT_RULES.reduce((sum, rule) => sum + rule.points, 0);

export function testerActivityMessage(accountId: string, txHash: string): string {
  return `Artiq tester activity\nAccount: ${accountId}\nChain: 5042002\nTransaction: ${txHash.toLowerCase()}`;
}

export function isTesterMilestoneKind(value: unknown): value is TesterMilestoneKind {
  return typeof value === "string" && TESTER_POINT_RULES.some((rule) => rule.kind === value);
}

export function testerMilestonePoints(kind: string): number {
  return TESTER_POINT_RULES.find((rule) => rule.kind === kind)?.points ?? 0;
}

export type TesterEntry = {
  id: string;
  rank: number;
  displayName: string;
  points: number;
  milestones: Array<{ kind: TesterMilestoneKind; points: number; earnedAt: string }>;
  joinedAt: string;
  lastActiveAt: string;
};

export type TesterLeaderboardResponse = {
  stats: { totalUsers: number; activeTesters7d: number; totalPoints: number };
  entries: TesterEntry[];
  pagination: { page: number; pageSize: number; totalPages: number; totalEntries: number };
  rules: typeof TESTER_POINT_RULES;
};
