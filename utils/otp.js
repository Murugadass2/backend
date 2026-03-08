/**
 * Generate a 6-digit numeric OTP
 * @returns {string}
 */
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Get OTP expiry datetime (now + minutes)
 * @param {number} minutes
 * @returns {Date}
 */
function getOTPExpiry(minutes = 10) {
    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + minutes);
    return expiry;
}

module.exports = { generateOTP, getOTPExpiry };
