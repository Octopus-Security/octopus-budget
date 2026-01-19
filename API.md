# Octopus Budget API Documentation

This document describes the REST API endpoints for mobile app integration.

## Authentication

The API uses JWT (JSON Web Token) authentication. Include the token in the `Authorization` header:

```
Authorization: Bearer <your-token>
```

### POST /api/auth/register

Register a new user and receive a JWT token.

**Request:**
```json
{
  "username": "string",
  "password": "string" (min 6 characters)
}
```

**Response:**
```json
{
  "success": true,
  "token": "jwt_token_string",
  "username": "string"
}
```

### POST /api/auth/login

Login and receive a JWT token.

**Request:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "token": "jwt_token_string",
  "username": "string"
}
```

**Token Expiration:** 7 days

## Subscriptions

All endpoints require JWT authentication.

### GET /api/budget/subscriptions

Get all subscriptions for the authenticated user.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Netflix",
      "amount": 15.99,
      "frequency": "monthly",
      "startDate": "2024-01-01T00:00:00.000Z",
      "notes": "Entertainment",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### POST /api/budget/subscriptions

Create a new subscription.

**Request:**
```json
{
  "name": "string" (required),
  "amount": number (required),
  "frequency": "daily|weekly|monthly|yearly" (required),
  "startDate": "ISO date string" (optional),
  "notes": "string" (optional)
}
```

**Response:** 201 with created subscription object

### PUT /api/budget/subscriptions/:id

Update an existing subscription.

**Request:** Same as POST (all fields optional in update)

**Response:** 200 with updated subscription object

### DELETE /api/budget/subscriptions/:id

Delete a subscription.

**Response:**
```json
{
  "success": true,
  "message": "Subscription deleted"
}
```

## Accounts

### GET /api/budget/accounts

Get all accounts for the authenticated user.

### POST /api/budget/accounts

Create a new account.

**Request:**
```json
{
  "name": "string" (required),
  "balance": number (required),
  "accountType": "string" (optional),
  "notes": "string" (optional)
}
```

### PUT /api/budget/accounts/:id

Update an existing account.

### DELETE /api/budget/accounts/:id

Delete an account.

## Income

### GET /api/budget/income

Get all income sources for the authenticated user.

### POST /api/budget/income

Create a new income source.

**Request:**
```json
{
  "source": "string" (optional),
  "amount": number (required),
  "frequency": "weekly|biweekly|monthly" (required),
  "startDate": "ISO date string" (optional),
  "notes": "string" (optional)
}
```

### PUT /api/budget/income/:id

Update an existing income source.

### DELETE /api/budget/income/:id

Delete an income source.

## Debts

### GET /api/budget/debts

Get all debts for the authenticated user.

### POST /api/budget/debts

Create a new debt.

**Request:**
```json
{
  "name": "string" (required),
  "totalAmount": number (optional),
  "remainingAmount": number (optional),
  "interestRate": number (optional),
  "minimumPayment": number (optional),
  "dueDate": "ISO date string" (optional),
  "notes": "string" (optional)
}
```

**Note:** The `balance` field is automatically calculated from `remainingAmount` (if provided) or `totalAmount`.

### PUT /api/budget/debts/:id

Update an existing debt.

### DELETE /api/budget/debts/:id

Delete a debt.

## Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message"
}
```

**Common HTTP Status Codes:**
- 200: Success
- 201: Created
- 400: Bad Request (validation error)
- 401: Unauthorized (missing/invalid token)
- 404: Not Found
- 500: Internal Server Error

## CORS

CORS is enabled for all origins. In production, you should configure this to only allow your mobile app's origin.

## Example Usage

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass123"}'

# Response: {"success":true,"token":"...","username":"testuser"}

# Use token to create subscription
curl -X POST http://localhost:3000/api/budget/subscriptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"name":"Netflix","amount":15.99,"frequency":"monthly"}'

# Get all subscriptions
curl -X GET http://localhost:3000/api/budget/subscriptions \
  -H "Authorization: Bearer <your-token>"
```

## Security Notes

1. Always use HTTPS in production
2. Store JWT tokens securely in your mobile app
3. Set `JWT_SECRET` environment variable to a strong random value
4. Consider adding rate limiting in production
5. Tokens expire after 7 days - handle token refresh in your app
