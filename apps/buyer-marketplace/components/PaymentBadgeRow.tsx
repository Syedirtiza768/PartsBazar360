import { Badge } from "@repo/ui/badge";
import { CreditCardIcon } from "@repo/ui/icons";
import { tamaraMarket } from "@/lib/tamara";

export function PaymentBadgeRow({ destinationCountry }: { destinationCountry?: string }) {
  const tamara = tamaraMarket(destinationCountry || "");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone="neutral" size="sm" icon={<CreditCardIcon />}>
        Card
      </Badge>
      {tamara && (
        <Badge tone="neutral" size="sm" icon={<CreditCardIcon />}>
          Tamara — Split in 4
        </Badge>
      )}
    </div>
  );
}
