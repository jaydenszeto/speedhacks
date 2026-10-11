import { IconStar } from "./icons";

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="stars" role="img" aria-label={`${value} of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={i < value ? "star on" : "star off"}>
          <IconStar size={size} filled={i < value} />
        </span>
      ))}
    </span>
  );
}
