'use strict';
/**
 * Planner tables. All NEW tables (nothing added to existing ones), so they
 * appear through the same per-login sync the other models use and need no
 * migration. They live in the user's own database file; the file is the
 * isolation boundary, so there is deliberately no owner column.
 */
const { DataTypes } = require('sequelize');

module.exports = function definePlannerModels(sequelize) {
  // An income source and its schedule. `days` is JSON: [15, 31] for semi-monthly,
  // [1] for monthly, ['2026-11-03', ...] for custom.
  const PaySource = sequelize.define('PaySource', {
    name:        { type: DataTypes.STRING, allowNull: false },
    amount:      { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },   // estimate per check
    schedule_type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'biweekly' },
    anchor_date: { type: DataTypes.DATEONLY, allowNull: true },
    days:        { type: DataTypes.TEXT, allowNull: true },
    holiday_rule: { type: DataTypes.STRING, allowNull: false, defaultValue: 'previous_business_day' },
    use_rolling_average: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    active:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  });

  // One row per payday that has been checked in. estimated_amount is what the
  // plan expected at the time, kept so estimated-vs-actual history stays honest
  // after the estimate changes.
  const Paycheck = sequelize.define('Paycheck', {
    source_id:        { type: DataTypes.INTEGER, allowNull: false },
    pay_date:         { type: DataTypes.DATEONLY, allowNull: false },
    estimated_amount: { type: DataTypes.FLOAT, allowNull: true },
    actual_amount:    { type: DataTypes.FLOAT, allowNull: true },
  }, { indexes: [{ unique: true, fields: ['source_id', 'pay_date'] }] });

  // A real due date for a bill that has none of its own (subscriptions today).
  // The plan steps forward from it by the subscription's own billing cycle.
  const BillDate = sequelize.define('BillDate', {
    kind:          { type: DataTypes.STRING, allowNull: false },   // 'subscription'
    ref_id:        { type: DataTypes.INTEGER, allowNull: false },
    next_due_date: { type: DataTypes.DATEONLY, allowNull: false },
  }, { indexes: [{ unique: true, fields: ['kind', 'ref_id'] }] });

  // Single row (id 1).
  const PlannerSetting = sequelize.define('PlannerSetting', {
    strategy:      { type: DataTypes.STRING, allowNull: false, defaultValue: 'avalanche' },
    cushion:       { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    periods_ahead: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 6 },
    avg_window:    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 4 },
  });

  return { PaySource, Paycheck, BillDate, PlannerSetting };
};
