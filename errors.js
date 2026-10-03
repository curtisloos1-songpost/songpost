'use strict';
// An error whose message is safe and useful to show to a customer.
class PublicError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.publicMessage = message;
    this.status = status;
  }
}
module.exports = { PublicError };
