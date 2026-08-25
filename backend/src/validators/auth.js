'use strict';

const Joi = require('joi');

const email = Joi.string().email().lowercase().trim().required();
const phone = Joi.string().pattern(/^\+?[0-9]{7,15}$/).messages({
  'string.pattern.base': 'Phone must be 7–15 digits, optionally starting with +',
});
const password = Joi.string().min(6).max(128).required();
const nin = Joi.string().pattern(/^\d{11}$/).messages({
  'string.pattern.base': 'NIN must be exactly 11 digits',
});

module.exports = {
  signupStep1: Joi.object({
    email,
    password,
  }),

  verifyOtp: Joi.object({
    email,
    code: Joi.string().length(6).pattern(/^\d{6}$/).required(),
    purpose: Joi.string().valid('signup', 'password_reset').required(),
  }),

  resendOtp: Joi.object({
    email,
    purpose: Joi.string().valid('signup', 'password_reset').required(),
  }),

  signupComplete: Joi.object({
    fullName: Joi.string().min(2).max(120).required(),
    phone: phone.required(),
    nin: nin.required(),
    dateOfBirth: Joi.date().iso().less('now').required(),
    state: Joi.string().required(),
    lga: Joi.string().required(),
    selfieUrl: Joi.string().uri().optional(),
  }),

  login: Joi.object({
    email,
    password,
  }),

  refresh: Joi.object({
    refreshToken: Joi.string().required(),
  }),

  forgotPassword: Joi.object({
    email,
  }),

  resetPassword: Joi.object({
    email,
    code: Joi.string().length(6).pattern(/^\d{6}$/).required(),
    newPassword: password,
  }),

  changePassword: Joi.object({
    currentPassword: password,
    newPassword: password,
  }),

  resubmitNin: Joi.object({
    firstName: Joi.string().min(1).max(60).required(),
    lastName: Joi.string().min(1).max(60).required(),
    nin: Joi.string().length(11).pattern(/^\d{11}$/).required(),
    dateOfBirth: Joi.date().iso().required(),
  }),
};
