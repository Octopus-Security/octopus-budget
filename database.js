const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

// Shared auth database for all users
const authDb = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'data', 'users.sqlite'),
    logging: false
});

const User = authDb.define('User', {
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    }
});

// Initialize auth database (async - will be awaited in app startup)
const initAuthDb = async () => {
    await authDb.sync();
};

initAuthDb().catch(err => console.error('Error initializing auth database:', err));

const getDatabase = (username) => {
    // Initialize Sequelize with SQLite
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
        startDate: {
            type: DataTypes.DATE,
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
        accountType: {
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
        startDate: {
            type: DataTypes.DATE,
            allowNull: true
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
        totalAmount: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        remainingAmount: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        balance: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        interestRate: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        minimumPayment: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        dueDate: {
            type: DataTypes.DATE,
            allowNull: true
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
        Debt
    };
}

module.exports = getDatabase;
module.exports.User = User;
module.exports.authDb = authDb;
