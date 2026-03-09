export const computeLaunchStatus = (totalSupply: number, totalPurchased: number, startsAt: Date, endsAt: Date): string => {
  const now = new Date();
  
  if (totalPurchased >= totalSupply) {
    return "SOLD_OUT";
  } else if (now < startsAt) {
    return "UPCOMING";
  } else if (now > endsAt) {
    return "ENDED";
  }
  
  return "ACTIVE";
};
