# Bento Order Checkout Details Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the checkout details layout in 'order' mode with 'payment' mode style, displaying 4 rows of financial details.

**Architecture:** Modify `CustomerCard.tsx` to display account balance, meal price, payment amount, and projected balance in order mode. Update `CustomerCard.test.tsx` to assert on these 4 rows and handle potential multiple matches of balance text.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library

---

### Task 1: Write failing unit tests for order mode checkout details

**Files:**
- Modify: `frontend/src/components/pos/__tests__/CustomerCard.test.tsx`

- [ ] **Step 1: Add unit tests for 4-line preview in order mode**
  We will add a new test case to `CustomerCard.test.tsx` verifying the 4 items shown in `order` mode.
  Append the following test case inside the main `describe('CustomerCard', ...)` block:
  ```typescript
  it('renders redesigned 4-line transaction preview in order mode', () => {
    const { container } = renderCard({
      mode: 'order',
      student: { studentId: 's1', displayName: '王小明', currentBalance: 500 },
      todayMenu: { itemName: '排骨便當', price: 90, vendorNameSnapshot: 'A' },
      payAmount: '100',
    });

    const billItems = container.querySelectorAll('.bill-item');
    expect(billItems).toHaveLength(4);

    // 1st item: 目前帳戶餘額
    const firstItem = billItems[0];
    expect(firstItem.querySelector('.bill-label')?.textContent).toBe('目前帳戶餘額');
    expect(firstItem.querySelector('.bill-val')?.textContent).toBe('$500');
    expect(firstItem.querySelector('.bill-val')?.className).not.toContain('neg');

    // 2nd item: 今日便當 (排骨便當)
    const secondItem = billItems[1];
    expect(secondItem.querySelector('.bill-label')?.textContent).toBe('今日便當 (排骨便當)');
    expect(secondItem.querySelector('.bill-val')?.textContent).toBe('−$90');
    expect(secondItem.querySelector('.bill-val')?.className).toContain('neg');

    // 3rd item: 此次繳費金額
    const thirdItem = billItems[2];
    expect(thirdItem.querySelector('.bill-label')?.textContent).toBe('此次繳費金額');
    expect(thirdItem.querySelector('.bill-val')?.textContent).toBe('+$100');
    expect(thirdItem.querySelector('.bill-val')?.className).toContain('pos');

    // 4th item: 預計結帳後餘額 (500 - 90 + 100 = 510)
    const fourthItem = billItems[3];
    expect(fourthItem.querySelector('.bill-label')?.textContent).toBe('預計結帳後餘額');
    expect(fourthItem.querySelector('.bill-val')?.textContent).toBe('$510');
    expect(fourthItem.querySelector('.bill-val')?.className).not.toContain('neg');
    expect(fourthItem.className).toContain('bill-total');
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `./workflow.sh t4-file components/pos/__tests__/CustomerCard.test.tsx`
  Expected: FAIL (because it currently renders only 1 row in `order` mode, not 4).

- [ ] **Step 3: Commit the test file**
  Run:
  ```bash
  git add frontend/src/components/pos/__tests__/CustomerCard.test.tsx
  git commit -m "test: add failing unit test for 4-line order mode checkout details"
  ```

---

### Task 2: Implement 4-line checkout details layout in CustomerCard.tsx

**Files:**
- Modify: `frontend/src/components/pos/CustomerCard.tsx`

- [ ] **Step 1: Modify calculation of projectedBalance in CustomerCard.tsx**
  Update line 30:
  ```typescript
  const projectedBalance = mode === 'order'
    ? student.currentBalance - effectiveMealPrice + parsedPayAmount
    : student.currentBalance + parsedPayAmount;
  ```

- [ ] **Step 2: Modify JSX for mode === 'order' in CustomerCard.tsx**
  Replace the block at lines 70-75 with the 4-line details layout:
  ```tsx
  {mode === 'order' && (
    <>
      <div className="bill-item no-border">
        <span className="bill-label">目前帳戶餘額</span>
        <span className={`bill-val${student.currentBalance < 0 ? ' neg' : ''}`}>
          {student.currentBalance < 0 ? '−' : ''}${fmt(student.currentBalance)}
        </span>
      </div>
      <div className="bill-item no-border">
        <span className="bill-label">今日便當 ({priceOverrideLabel || todayMenu.itemName})</span>
        <span className="bill-val neg">−${fmt(effectiveMealPrice)}</span>
      </div>
      <div className="bill-item no-border">
        <span className="bill-label">此次繳費金額</span>
        <span className="bill-val pos">
          +${fmt(parsedPayAmount)}
        </span>
      </div>
      <div className="bill-divider" />
      <div className="bill-item bill-total">
        <span className="bill-label">預計結帳後餘額</span>
        <span className={`bill-val${projectedBalance < 0 ? ' neg' : ''}`}>
          {projectedBalance < 0 ? '−' : ''}${fmt(projectedBalance)}
        </span>
      </div>
    </>
  )}
  ```

- [ ] **Step 3: Run the unit test to verify it passes**
  Run: `./workflow.sh t4-file components/pos/__tests__/CustomerCard.test.tsx`
  Expected: PASS.
  If any existing tests fail due to multiple elements matching text (e.g., balance matching both the top balance header and the billing detail row), adjust those tests to use `screen.getAllByText` or target specific container areas.

- [ ] **Step 4: Run full type check, linting, and unit tests**
  Run: `./workflow.sh t2` (Type Check)
  Run: `./workflow.sh t3` (Lint)
  Run: `./workflow.sh t4` (Full unit tests)
  Run: `./workflow.sh t1` (Vite Build)

- [ ] **Step 5: Commit changes**
  Run:
  ```bash
  git add frontend/src/components/pos/CustomerCard.tsx
  git commit -m "feat: implement 4-line checkout details layout in order mode"
  ```
