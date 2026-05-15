import { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const ALL = "__all__";

export function AgencyCombobox({
  value,
  onChange,
  agencies,
  placeholder = "All agencies",
  className,
  width = "w-[240px]",
}: {
  value: string;
  onChange: (v: string) => void;
  agencies: string[];
  placeholder?: string;
  className?: string;
  width?: string;
}) {
  const [open, setOpen] = useState(false);

  const selectedLabel = value === ALL ? placeholder : value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(width, "justify-between font-normal h-9", className)}
        >
          <span className="truncate text-left flex-1">{selectedLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn(width, "p-0")} align="start">
        <Command>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <CommandInput
              placeholder="Search agencies..."
              className="h-10 border-0 focus:ring-0 px-0"
            />
          </div>
          <CommandList className="max-h-[280px]">
            <CommandEmpty>No agency found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={placeholder}
                onSelect={() => {
                  onChange(ALL);
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-4 w-4", value === ALL ? "opacity-100" : "opacity-0")} />
                {placeholder}
              </CommandItem>
              {agencies.map((a) => (
                <CommandItem
                  key={a}
                  value={a}
                  onSelect={() => {
                    onChange(a);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === a ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{a}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
