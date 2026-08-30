"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  X,
  User as UserIcon,
  Wallet,
  Receipt,
  CreditCard,
  RotateCcw,
  Lock,
  History,
  IndianRupee,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertTriangle,
  Utensils,
  ShieldCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { UserAvatar } from "@/components/glass/user-avatar";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { TWO_FACTOR_AUTH_ENABLED } from "@/lib/feature-flags";

type Profile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  avatarUrl: string | null;
  room: string | null;
  gender: string | null;
  emergencyContact: string | null;
  institutionName: string | null;
  institutionUserId: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

type FundAccount = {
  availableBalance: number;
  pendingDeposits: number;
  refundPending: number;
  outstandingDue: number;
  previousDue: number;
  financialStatus: string;
  totalDeposited: number;
  totalBilled: number;
  totalRefunded: number;
  ledgerEntryCount: number;
};

type RestrictionEval = {
  canBookMeals: boolean;
  financialStatus: string;
  availableBalance: number;
  requiredBalance: number;
  graceDaysRemaining: number | null;
  hasExemption: boolean;
  restrictionReason: string | null;
};

type Bill = {
  id: string;
  billNumber: string | null;
  periodMonth: number;
  periodYear: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  previousDue: number;
  status: string;
  dueDate: string | null;
};

type Payment = {
  id: string;
  amount: number;
  method: string;
  status: string;
  reference: string | null;
  effectiveMonth: number | null;
  effectiveYear: number | null;
  createdAt: string;
};

type Refund = {
  id: string;
  refundNumber: string | null;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
  createdAt: string;
};

type LedgerEntry = {
  id: string;
  type: string;
  amount: number;
  runningBalance: number;
  description: string;
  createdAt: string;
};

type ActiveRestriction = {
  id: string;
  type: string;
  reason: string;
  source: string;
  status: string;
  appliedAt: string;
  expiresAt: string | null;
};

type LoginHistoryEntry = {
  id: string;
  success: boolean;
  ipAddress: string | null;
  createdAt: string;
  reason: string | null;
};

type DataAvailability = {
  profile: boolean;
  loginHistory: boolean;
  fundAccount: boolean;
  bills: boolean;
  payments: boolean;
  refunds: boolean;
  ledger: boolean;
  meals: boolean;
  restrictions: boolean;
};

type Resident360 = {
  profile: Profile;
  fundAccount: FundAccount | null;
  restrictions: RestrictionEval | null;
  activeRestrictions: ActiveRestriction[];
  recentBills: Bill[];
  recentPayments: Payment[];
  recentRefunds: Refund[];
  ledger: LedgerEntry[];
  mealStats: { currentMonthON: number } | null;
  loginHistory: LoginHistoryEntry[];
  dataAvailability: DataAvailability;
  contractVersion?: number;
};

type ApiResponse<T> = { success: boolean; data: T };

type Tab = "overview" | "bills" | "payments" | "ledger" | "restrictions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_COLORS: Record<string, string> = {
  HEALTHY: "text-success",
  LOW_BALANCE: "text-warning",
  RESTRICTED: "text-destructive",
  EXEMPTED: "text-primary",
  OVERDUE: "text-destructive",
};

const TABS: { key: Tab; label: string; icon: typeof UserIcon }[] = [
  { key: "overview", label: "Overview", icon: UserIcon },
  { key: "bills", label: "Bills", icon: Receipt },
  { key: "payments", label: "Payments", icon: CreditCard },
  { key: "ledger", label: "Ledger", icon: History },
  { key: "restrictions", label: "Restrictions", icon: Lock },
];

function formatINR(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function monthLabel(month: number | null) {
  if (month === null) return "—";
  const index = month >= 1 && month <= 12 ? month - 1 : month;
  return MONTHS[index] ?? String(month);
}

export function Resident360Dialog({
  userId,
  open,
  onClose,
}: {
  userId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    if (open) setTab("overview");
  }, [open, userId]);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["user-360", userId],
    queryFn: async () => {
      if (!userId) return null;
      const response = await api.get<ApiResponse<Resident360>>(`/users/${userId}/360`);
      if (!response?.success || !response.data?.profile) {
        throw new Error("User 360 returned an invalid response");
      }
      return response.data;
    },
    enabled: !!userId && open,
    retry: 1,
  });

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-2xl max-h-[92vh] overflow-y-auto p-0"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Resident 360° View</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <User360Skeleton />
        ) : isError ? (
          <User360Error
            message={error instanceof Error ? error.message : "Unable to load User 360"}
            retrying={isFetching}
            onRetry={() => void refetch()}
          />
        ) : !data ? (
          <User360Error
            message="User 360 returned no data."
            retrying={isFetching}
            onRetry={() => void refetch()}
          />
        ) : (
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <UserAvatar
                  name={data.profile.name}
                  avatarUrl={data.profile.avatarUrl}
                  className="h-14 w-14 rounded-2xl"
                  fallbackClassName="text-lg"
                />
                <div className="min-w-0">
                  <h2 className="text-xl font-bold truncate">{data.profile.name}</h2>
                  <p className="text-sm text-muted-foreground truncate">{data.profile.email}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-medium",
                        data.profile.status === "ACTIVE"
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {data.profile.status}
                    </span>
                    {data.profile.room && (
                      <span className="text-[10px] text-muted-foreground">Room {data.profile.room}</span>
                    )}
                    {data.profile.institutionUserId && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {data.profile.institutionUserId}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <GlassButton
                variant="ghost"
                size="icon"
                aria-label="Close User 360"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </GlassButton>
            </div>

            <div className="flex gap-1 p-1 rounded-2xl glass-soft" role="tablist" aria-label="User 360 sections">
              {TABS.map((item) => {
                const Icon = item.icon;
                const selected = tab === item.key;
                return (
                  <button
                    key={item.key}
                    id={`user-360-tab-${item.key}`}
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`user-360-panel-${item.key}`}
                    onClick={() => setTab(item.key)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-colors",
                      selected
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Functional content must never depend on an entrance animation.
                An interrupted Framer Motion opacity animation could strand this
                entire region at opacity:0 while it still occupied full height. */}
            <div
              id={`user-360-panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`user-360-tab-${tab}`}
              data-testid="user-360-tab-content"
              className="space-y-3 opacity-100"
            >
              {tab === "overview" && <OverviewTab data={data} />}
              {tab === "bills" && <BillsTab bills={data.recentBills} available={data.dataAvailability.bills} />}
              {tab === "payments" && (
                <PaymentsTab
                  payments={data.recentPayments}
                  refunds={data.recentRefunds}
                  paymentsAvailable={data.dataAvailability.payments}
                  refundsAvailable={data.dataAvailability.refunds}
                />
              )}
              {tab === "ledger" && <LedgerTab ledger={data.ledger} available={data.dataAvailability.ledger} />}
              {tab === "restrictions" && <RestrictionsTab data={data} />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function User360Skeleton() {
  return (
    <div className="p-6 space-y-3" aria-label="Loading User 360">
      <ShimmerSkeleton className="h-16 rounded-3xl" />
      <ShimmerSkeleton className="h-12 rounded-2xl" />
      <ShimmerSkeleton className="h-48 rounded-3xl" />
    </div>
  );
}

function User360Error({
  message,
  retrying,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="p-6">
      <GlassCard className="p-6 text-center" hover={false}>
        <AlertTriangle className="h-9 w-9 text-destructive mx-auto mb-3" />
        <h3 className="font-semibold">Could not load User 360</h3>
        <p className="text-sm text-muted-foreground mt-1 mb-4">{message}</p>
        <GlassButton variant="primary" size="sm" onClick={onRetry} loading={retrying}>
          <RotateCcw className="h-4 w-4" />
          Retry
        </GlassButton>
      </GlassCard>
    </div>
  );
}

function OverviewTab({ data }: { data: Resident360 }) {
  const fundAccount = data.fundAccount;
  const restrictions = data.restrictions;

  return (
    <div className="space-y-3" data-testid="user-360-overview">
      {data.dataAvailability.fundAccount && fundAccount ? (
        <GlassCard className="p-4" hover={false}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Wallet className="h-3 w-3" /> Resident Fund Account
            </p>
            <span className={cn("text-xs font-bold", STATUS_COLORS[fundAccount.financialStatus] || "text-muted-foreground")}>
              {fundAccount.financialStatus}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Available Balance" value={formatINR(fundAccount.availableBalance)} icon={IndianRupee} color="text-success" />
            <Stat label="Outstanding Due" value={formatINR(fundAccount.outstandingDue)} icon={TrendingDown} color="text-destructive" />
            <Stat label="Pending Deposits" value={formatINR(fundAccount.pendingDeposits)} icon={TrendingUp} color="text-warning" />
            <Stat label="Refund Pending" value={formatINR(fundAccount.refundPending)} icon={RotateCcw} color="text-info" />
          </div>
          <div className="mt-3 pt-3 border-t border-border grid grid-cols-3 gap-2 text-center">
            <MiniStat label="Total Deposited" value={formatINR(fundAccount.totalDeposited)} />
            <MiniStat label="Total Billed" value={formatINR(fundAccount.totalBilled)} />
            <MiniStat label="Total Refunded" value={formatINR(fundAccount.totalRefunded)} />
          </div>
        </GlassCard>
      ) : (
        <UnavailableCard
          icon={Wallet}
          title="Resident Fund Account"
          description="Financial account data is not part of the current D1 schema yet. This section will populate automatically when the finance domain is introduced."
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.dataAvailability.meals && data.mealStats ? (
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Utensils className="h-3.5 w-3.5" /> Meals This Month
            </div>
            <p className="text-2xl font-bold tabular-nums">{data.mealStats.currentMonthON}</p>
            <p className="text-[10px] text-muted-foreground">ON / LOCKED entries</p>
          </GlassCard>
        ) : (
          <UnavailableCard
            compact
            icon={Utensils}
            title="Meal activity"
            description="Meal data is not available in the current schema."
          />
        )}

        {data.dataAvailability.restrictions && restrictions ? (
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              {restrictions.canBookMeals ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              ) : (
                <Lock className="h-3.5 w-3.5 text-destructive" />
              )}
              Meal Booking
            </div>
            <p className="text-lg font-bold">{restrictions.canBookMeals ? "Enabled" : "Restricted"}</p>
            {restrictions.graceDaysRemaining !== null && restrictions.graceDaysRemaining > 0 && (
              <p className="text-[10px] text-warning">Grace: {restrictions.graceDaysRemaining}d left</p>
            )}
          </GlassCard>
        ) : (
          <UnavailableCard
            compact
            icon={Lock}
            title="Restrictions"
            description="Restriction evaluation is not available in the current schema."
          />
        )}
      </div>

      <GlassCard className="p-4" hover={false}>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Profile</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Detail label="Phone" value={data.profile.phone || "—"} />
          <Detail label="Gender" value={data.profile.gender || "—"} />
          <Detail label="Resident ID" value={data.profile.institutionUserId || "—"} />
          <Detail label="Institution" value={data.profile.institutionName || "—"} />
          <Detail label="Emergency Contact" value={data.profile.emergencyContact || "—"} />
          <Detail label="Joined" value={format(new Date(data.profile.createdAt), "d MMM yyyy")} />
          <Detail label="Last Login" value={data.profile.lastLoginAt ? format(new Date(data.profile.lastLoginAt), "d MMM yyyy, h:mm a") : "Never"} />
          <Detail label="Email Verified" value={data.profile.emailVerified ? "Yes" : "No"} />
          <Detail label="2FA" value={TWO_FACTOR_AUTH_ENABLED && data.profile.twoFactorEnabled ? "Enabled" : "Disabled"} />
        </div>
      </GlassCard>

      <GlassCard className="p-4" hover={false}>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> Recent Sign-ins
        </p>
        {!data.dataAvailability.loginHistory ? (
          <p className="text-xs text-muted-foreground">Login history is not available.</p>
        ) : data.loginHistory.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sign-in history yet.</p>
        ) : (
          <div className="space-y-2">
            {data.loginHistory.map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-3 rounded-xl glass-soft p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{entry.success ? "Successful sign-in" : "Failed sign-in"}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(entry.createdAt), "d MMM yyyy, h:mm a")}
                    {entry.ipAddress ? ` · ${entry.ipAddress}` : ""}
                  </p>
                  {entry.reason && <p className="text-[10px] text-muted-foreground mt-0.5">{entry.reason}</p>}
                </div>
                <span className={cn("text-[10px] font-medium shrink-0", entry.success ? "text-success" : "text-destructive")}>
                  {entry.success ? "SUCCESS" : "FAILED"}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function BillsTab({ bills, available }: { bills: Bill[]; available: boolean }) {
  if (!available) {
    return (
      <UnavailableCard
        icon={Receipt}
        title="Billing history"
        description="Bills are not available in the current D1 schema yet."
      />
    );
  }
  if (bills.length === 0) return <EmptyState icon={Receipt} label="No bills yet" />;

  return (
    <div className="space-y-2">
      {bills.map((bill) => (
        <div key={bill.id} className="flex items-center justify-between p-3 rounded-2xl glass-soft">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {bill.billNumber || "—"} · {monthLabel(bill.periodMonth)} {bill.periodYear}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Total {formatINR(bill.totalAmount)} · Paid {formatINR(bill.paidAmount)} · Due {formatINR(bill.dueAmount)}
              {bill.previousDue > 0 && ` · Previous ${formatINR(bill.previousDue)}`}
            </p>
          </div>
          <span
            className={cn(
              "text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0",
              bill.status === "PAID"
                ? "bg-success/15 text-success"
                : bill.status === "PARTIALLY_PAID"
                  ? "bg-warning/15 text-warning"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {bill.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function PaymentsTab({
  payments,
  refunds,
  paymentsAvailable,
  refundsAvailable,
}: {
  payments: Payment[];
  refunds: Refund[];
  paymentsAvailable: boolean;
  refundsAvailable: boolean;
}) {
  if (!paymentsAvailable && !refundsAvailable) {
    return (
      <UnavailableCard
        icon={CreditCard}
        title="Payments & refunds"
        description="Payment and refund records are not available in the current D1 schema yet."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Payments</p>
        {!paymentsAvailable ? (
          <p className="text-xs text-muted-foreground">Payment data is not available.</p>
        ) : payments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No payments yet.</p>
        ) : (
          payments.map((payment) => (
            <div key={payment.id} className="flex items-center justify-between p-2.5 rounded-xl glass-soft">
              <div>
                <p className="text-sm font-medium">{formatINR(payment.amount)} · {payment.method}</p>
                <p className="text-[10px] text-muted-foreground">
                  {format(new Date(payment.createdAt), "d MMM yyyy")}
                  {payment.effectiveMonth !== null && ` · Effective: ${monthLabel(payment.effectiveMonth)} ${payment.effectiveYear ?? ""}`}
                </p>
              </div>
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", payment.status === "APPROVED" ? "bg-success/15 text-success" : payment.status === "PENDING" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>
                {payment.status}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Refunds</p>
        {!refundsAvailable ? (
          <p className="text-xs text-muted-foreground">Refund data is not available.</p>
        ) : refunds.length === 0 ? (
          <p className="text-xs text-muted-foreground">No refunds yet.</p>
        ) : (
          refunds.map((refund) => (
            <div key={refund.id} className="flex items-center justify-between p-2.5 rounded-xl glass-soft">
              <div>
                <p className="text-sm font-medium">{refund.refundNumber || "—"} · {formatINR(refund.amount)}</p>
                <p className="text-[10px] text-muted-foreground">
                  Paid {formatINR(refund.paidAmount)} · Remaining {formatINR(refund.remainingAmount)}
                </p>
              </div>
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", refund.status === "COMPLETED" ? "bg-success/15 text-success" : refund.status === "PARTIALLY_PAID" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>
                {refund.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LedgerTab({ ledger, available }: { ledger: LedgerEntry[]; available: boolean }) {
  if (!available) {
    return (
      <UnavailableCard
        icon={History}
        title="Resident ledger"
        description="Ledger entries are not available in the current D1 schema yet."
      />
    );
  }
  if (ledger.length === 0) return <EmptyState icon={History} label="No ledger entries yet" />;

  return (
    <div className="space-y-1.5">
      {ledger.map((entry) => (
        <div key={entry.id} className="flex items-center justify-between p-2.5 rounded-xl glass-soft">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{entry.description}</p>
            <p className="text-[10px] text-muted-foreground">
              {format(new Date(entry.createdAt), "d MMM yyyy, h:mm a")} · {entry.type}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className={cn("text-sm font-bold tabular-nums", entry.amount >= 0 ? "text-success" : "text-destructive")}>
              {entry.amount >= 0 ? "+" : ""}{formatINR(entry.amount)}
            </p>
            <p className="text-[10px] text-muted-foreground">Bal: {formatINR(entry.runningBalance)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function RestrictionsTab({ data }: { data: Resident360 }) {
  const restrictions = data.restrictions;
  if (!data.dataAvailability.restrictions || !restrictions) {
    return (
      <UnavailableCard
        icon={Lock}
        title="Restriction evaluation"
        description="Financial and administrative restriction evaluation is not available in the current D1 schema yet."
      />
    );
  }

  return (
    <div className="space-y-3">
      <GlassCard className="p-4" hover={false}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">Current Status</p>
          <span className={cn("text-sm font-bold", STATUS_COLORS[restrictions.financialStatus] || "text-muted-foreground")}>
            {restrictions.financialStatus}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Detail label="Can Book Meals" value={restrictions.canBookMeals ? "Yes" : "No"} />
          <Detail label="Has Exemption" value={restrictions.hasExemption ? "Yes" : "No"} />
          <Detail label="Available" value={formatINR(restrictions.availableBalance)} />
          <Detail label="Required" value={formatINR(restrictions.requiredBalance)} />
          {restrictions.graceDaysRemaining !== null && (
            <Detail label="Grace Days" value={`${restrictions.graceDaysRemaining} day(s)`} />
          )}
        </div>
        {restrictions.restrictionReason && (
          <div className="mt-2 p-2 rounded-xl bg-destructive/10 ring-1 ring-destructive/30">
            <p className="text-xs text-destructive">{restrictions.restrictionReason}</p>
          </div>
        )}
      </GlassCard>

      {data.activeRestrictions.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">No active restrictions.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Restrictions</p>
          {data.activeRestrictions.map((restriction) => (
            <div key={restriction.id} className="p-3 rounded-xl glass-soft">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", restriction.type === "FINANCIAL" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning")}>
                  {restriction.type}
                </span>
                <span className="text-[10px] text-muted-foreground">{restriction.source}</span>
                {restriction.expiresAt && (
                  <span className="text-[10px] text-muted-foreground">
                    Expires: {format(new Date(restriction.expiresAt), "d MMM yyyy")}
                  </span>
                )}
              </div>
              <p className="text-sm">{restriction.reason}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Applied: {format(new Date(restriction.appliedAt), "d MMM yyyy")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UnavailableCard({
  icon: Icon,
  title,
  description,
  compact = false,
}: {
  icon: typeof Receipt;
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <GlassCard className={cn("border border-border/60", compact ? "p-4" : "p-5")} hover={false}>
      <div className="flex items-start gap-3">
        <div className="grid place-items-center h-9 w-9 rounded-xl bg-muted/70 text-muted-foreground shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
          <p className="text-[10px] text-muted-foreground/80 mt-2">Not available in this phase</p>
        </div>
      </div>
    </GlassCard>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: typeof IndianRupee;
  color: string;
}) {
  return (
    <div className="p-2.5 rounded-xl glass-soft">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
        <Icon className={cn("h-3 w-3", color)} />
        {label}
      </div>
      <p className={cn("text-base font-bold tabular-nums", color)}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium break-words">{value}</p>
    </div>
  );
}

function EmptyState({ icon: Icon, label }: { icon: typeof Receipt; label: string }) {
  return (
    <div className="text-center py-8">
      <Icon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
