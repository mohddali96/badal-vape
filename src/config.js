// Central business configuration for the Pakistani market.
module.exports = {
  STORE_NAME: 'Badal Vapes',
  CURRENCY: 'PKR',
  MIN_AGE: 18,

  // Delivery charges in PKR. Major metros get the lower rate.
  METRO_CITIES: ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi'],
  SHIPPING_METRO: 250,
  SHIPPING_OTHER: 350,
  FREE_SHIPPING_OVER: 15000,

  CITIES: [
    'Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan',
    'Peshawar', 'Quetta', 'Hyderabad', 'Sialkot', 'Gujranwala', 'Abbottabad',
    'Sargodha', 'Bahawalpur', 'Sukkur',
  ],

  PAYMENT_METHODS: {
    cod: 'Cash on Delivery',
    jazzcash: 'JazzCash',
    easypaisa: 'Easypaisa',
    bank: 'Bank Transfer (Raast / IBFT)',
  },

  ORDER_STATUSES: ['Pending', 'Confirmed', 'Dispatched', 'Delivered', 'Cancelled'],

  BCRYPT_ROUNDS: Number(process.env.BCRYPT_ROUNDS) || 10,
  PAGE_SIZE: 12,
};
