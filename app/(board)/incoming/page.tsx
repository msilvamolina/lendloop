import { LoanList } from "@/components/loan-list";

export default function IncomingPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Incoming requests</h1>
          <p>Neighbors who want to borrow your tools. Approve, decline, and mark them returned here.</p>
        </div>
      </div>
      <LoanList perspective="lender" empty="No one has asked for your tools yet." />
    </>
  );
}
