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
  // Use the first X-Forwarded-For IP (Render proxy)
  keyGenerator: (req) => {
    // Get the real IP from the proxy
    return req.ip || req.connection.remoteAddress;
  },
  validate: { trustProxy: false }, // Skip validation since we trust proxy
});

// Strict limiter for auth endpoints - 5 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    error: "Too many login attempts",
    message: "Please try again after 15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.connection.remoteAddress,
  skipSuccessfulRequests: true,
  validate: { trustProxy: false },
});

// M-Pesa specific limiter - 3 STK Push per minute per user
const mpesaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: {
    error: "Too many payment attempts",
    message: "Please wait a moment before trying again",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip || req.connection.remoteAddress,
  validate: { trustProxy: false },
});

// Slow down for aggressive clients
const slowDownLimiter = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 50,
  delayMs: 500,
  maxDelayMs: 10000,
});

// Stricter slow down for invoice creation
const invoiceSlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 10,
  delayMs: 1000,
  maxDelayMs: 15000,
});

module.exports = {
  apiLimiter,
  authLimiter,
  mpesaLimiter,
  slowDownLimiter,
  invoiceSlowDown,
};
