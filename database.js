const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

// User data is now handled by octopus-auth service
// This file only handles budget-specific data models

const getDatabase = (username) => {
    // Initialize Sequelize with SQLite - per-user database for budget data
    const sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: path.join(__dirname, 'data', `${username}_database.sqlite`),
        logging: false
    });

    // Define the models
    const Subscription = sequelize.define('Subscription', {
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        amount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        frequency: {
            type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'yearly'),
            allowNull: false
        },
        category: {
            type: DataTypes.STRING,
            allowNull: true
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    });

    const Account = sequelize.define('Account', {
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        balance: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        type: {
            type: DataTypes.STRING,
            allowNull: true
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    });

    const Income = sequelize.define('Income', {
        source: {
            type: DataTypes.STRING,
            allowNull: true
        },
        amount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        frequency: {
            type: DataTypes.ENUM('weekly', 'biweekly', 'monthly'),
            allowNull: false
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    });

    const Debt = sequelize.define('Debt', {
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        amount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        balance: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        interest_rate: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        minimum_payment: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        due_date: {
            type: DataTypes.DATE,
            allowNull: true
        },
        // Day of month (1–28) for recurring monthly payment reminder
        due_day: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        credit_limit: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    });

    // Affirm / Klarna / BNPL installment plans
    const Installment = sequelize.define('Installment', {
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        provider: {
            type: DataTypes.STRING,  // affirm | klarna | other
            allowNull: false,
            defaultValue: 'other'
        },
        total_amount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        paid_amount: {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 0
        },
        payment_amount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        next_due_date: {
            type: DataTypes.DATEONLY,  // YYYY-MM-DD
            allowNull: false
        },
        remaining_payments: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        frequency: {
            type: DataTypes.STRING,  // biweekly | monthly
            allowNull: false,
            defaultValue: 'biweekly'
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    });

    return {
        sequelize,
        Subscription,
        Account,
        Income,
        Debt,
        Installment
    };
}

module.exports = getDatabase;
