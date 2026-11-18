import { LoanList } from "@/components/loan-list";

export default function MyRequestsPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>My requests</h1>
          <p>Tools you asked to borrow, newest first.</p>
        </div>
      </div>
      <LoanList perspective="borrower" empty="You haven’t asked to borrow anything yet." />
    </>
  );
}
