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

// Initialize auth database
authDb.sync();

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
        }
    });

    const Income = sequelize.define('Income', {
        amount: {
            type: DataTypes.FLOAT,
            allowNull: false
        },
        frequency: {
            type: DataTypes.ENUM('weekly', 'biweekly', 'monthly'),
            allowNull: false
        }
    });

    const Debt = sequelize.define('Debt', {
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        balance: {
            type: DataTypes.FLOAT,
            allowNull: false
        }
    });

    // Sync the models with the database
    sequelize.sync();

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
