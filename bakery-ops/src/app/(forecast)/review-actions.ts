"use server";

import {
  getDailyReview,
  saveDailyReview,
  adoptDailyReview,
  getContextEvents,
  addContextEvent,
  deleteContextEvent,
  getHolidays,
  addHoliday,
  deleteHoliday,
  getDailySalesTotal,
  getDailyRevenues,
  saveManagerRevenue,
  getProductSalesTrend,
} from "@/modules/data/repositories/forecast.repository";

export {
  getDailyReview,
  saveDailyReview,
  adoptDailyReview,
  getContextEvents,
  addContextEvent,
  deleteContextEvent,
  getHolidays,
  addHoliday,
  deleteHoliday,
  getDailySalesTotal,
  getDailyRevenues,
  saveManagerRevenue,
  getProductSalesTrend,
};
