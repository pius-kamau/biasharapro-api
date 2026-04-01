const rateLimit = require("express-rate-limit");
const slowDown = require("express-slow-down");

// General API rate limiter - 100 requests per minute
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests",
    message: "Please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// Strict limiter for auth endpoints - 5 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    error: "Too many login attempts",
    message: "Please try again after 15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failed attempts
});

// M-Pesa specific limiter - 3 STK Push per minute per user
const mpesaLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // limit each IP to 3 STK Push requests per minute
  message: {
    error: "Too many payment attempts",
    message: "Please wait a moment before trying again",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise IP
    return req.user?.id || req.ip;
  },
});

// Slow down for aggressive clients (slows them down instead of blocking)
const slowDownLimiter = slowDown({
  windowMs: 60 * 1000, // 1 minute
  delayAfter: 50, // allow 50 requests per minute
  delayMs: 500, // then add 500ms delay per request above limit
  maxDelayMs: 10000, // max delay is 10 seconds
});

// Stricter slow down for invoice creation
const invoiceSlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 10, // after 10 invoices per minute
  delayMs: 1000, // add 1 second delay
  maxDelayMs: 15000, // max 15 seconds
});

module.exports = {
  apiLimiter,
  authLimiter,
  mpesaLimiter,
  slowDownLimiter,
  invoiceSlowDown,
};
