import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  History,
  ChefHat,
  BarChart3,
  ChartNoAxesCombined,
  ShieldCheck,
  FileText,
  Beef,
  Package,
  LeafyGreen,
  Milk,
  SprayCan,
  CookingPot,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  BottleWine,
  Users,
  LogOut,
  Warehouse,
  Settings,
  Tags,
  MapPin,
  TrendingUp,
  Sparkles,
  Scissors,
  ShoppingCart,
  Phone,
  ChartBar,
} from "lucide-react";
import { useBranding, DEFAULT_LOGO_URL } from "@/lib/branding";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { useManagerMode } from "@/lib/manager-mode";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgId } from "@/lib/use-org-id";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const operationalItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Estoque Central", url: "/central", icon: Warehouse },
  { title: "Produção", url: "/producao", icon: ChefHat },
  { title: "Processamento", url: "/processamento", icon: Scissors },
  { title: "Inventário", url: "/inventario", icon: ClipboardList },
  { title: "Checklists", url: "/checklists", icon: ClipboardCheck },
  { title: "Histórico", url: "/historico", icon: History },
];


const managerItems = [
  { title: "Compras", url: "/suprimentos", icon: ShoppingCart },
  { title: "Solicitações de Ajuste", url: "/ajustes", icon: ClipboardCheck },
  { title: "Notas Processadas", url: "/notas", icon: FileText },
  { title: "Fichas Técnicas", url: "/fichas", icon: ChefHat },
  { title: "Auditorias de Turno", url: "/auditorias", icon: ClipboardCheck },
  { title: "Relatórios CMV", url: "/relatorios", icon: BarChart3 },
  { title: "DRE", url: "/dre", icon: ChartBar },
  { title: "Equipe", url: "/equipe", icon: Users },
];

const categoryIconMap: Record<string, typeof Beef> = {
  proteinas: Beef,
  proteínas: Beef,
  secos: Package,
  "estoque seco": Package,
  hortifruti: LeafyGreen,
  laticinios: Milk,
  laticínios: Milk,
  limpeza: SprayCan,
  "descartáveis e embalagens": Boxes,
  "descartaveis e embalagens": Boxes,
  "produção própria": CookingPot,
  "producao propria": CookingPot,
};

function getCategoryIcon(name: string) {
  const key = name.toLowerCase().trim();
  return categoryIconMap[key] ?? BottleWine;
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isManager } = useManagerMode();
  const { user, signOut } = useAuth();
  // Sidebar title is ALWAYS the fixed system name — never bound to the user's fantasy name.
  const logoSrc = DEFAULT_LOGO_URL;
  const location = useLocation();
  const orgId = useOrgId();
  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const { data: categories } = useQuery({
    queryKey: ["sidebar-categories", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [catRes, hidRes] = await Promise.all([
        supabase
          .from("categories")
          .select("id,name,parent_id")
          .eq("org_id", orgId!)
          .order("name"),
        supabase
          .from("hidden_system_categories")
          .select("category_id")
          .eq("org_id", orgId!),
      ]);
      if (catRes.error) throw catRes.error;
      if (hidRes.error) throw hidRes.error;
      const hiddenIds = new Set(
        (hidRes.data ?? []).map((r) => r.category_id as string),
      );
      // Oculta categorias internas do sistema (ex.: "Sistema") e as ocultas
      // pelo usuário em /categorias.
      const visible = (catRes.data ?? []).filter(
        (c) =>
          c.name.trim().toLowerCase() !== "sistema" &&
          !hiddenIds.has(c.id),
      );
      const parents = visible.filter((c) => !c.parent_id);
      const childrenByParent = new Map<string, typeof visible>();
      visible.forEach((c) => {
        if (!c.parent_id) return;
        const arr = childrenByParent.get(c.parent_id) ?? [];
        arr.push(c);
        childrenByParent.set(c.parent_id, arr);
      });
      return { parents, childrenByParent };
    },
  });

  const { data: destinationLocations } = useQuery({
    queryKey: ["sidebar-destinations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id,name")
        .order("name");
      if (error) throw error;
      // Defensive: never list "Estoque Central" as an operational destination —
      // it is the main storage entity, surfaced via the fixed link above.
      return (data ?? []).filter(
        (l) => l.name.trim().toLowerCase() !== "estoque central",
      );
    },
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-0 m-0 gap-0">
        {collapsed ? (
          <div className="flex items-center justify-center py-2">
            <TrendingUp
              className="h-7 w-7 text-primary"
              strokeWidth={2.5}
              aria-label="Controller CMV Pro"
            />
          </div>
        ) : (
          <div className="flex flex-col items-stretch justify-start w-full p-0 m-0 gap-0">
            <img
              src={logoSrc}
              alt="Controller CMV Pro"
              className="block"
              style={{ width: "100%", height: "auto", maxWidth: "none", padding: 0, margin: 0, marginTop: 0, marginBottom: 0, display: "block" }}
            />
            <p className="flex items-center justify-center text-[10px] uppercase tracking-wide leading-none text-muted-foreground p-0 m-0">
              {isManager ? <ShieldCheck className="h-3 w-3" /> : <ChartNoAxesCombined className="h-3 w-3" />}
              {isManager ? "Modo Gestor" : "Operacional"}
            </p>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="gap-0">
        <SidebarGroup className="pt-0 mt-0 pb-0">
          <SidebarGroupLabel>Operação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {operationalItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {(destinationLocations ?? []).map((loc) => {
                const active = location.pathname === `/local/${loc.id}`;
                return (
                  <SidebarMenuItem key={loc.id}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link to="/local/$locationId" params={{ locationId: loc.id }}>
                        <MapPin className="h-4 w-4" />
                        <span>{loc.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isManager && (
          <SidebarGroup>
            <SidebarGroupLabel>Gestão</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {managerItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <Link to={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {categories && categories.parents.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Categorias</SidebarGroupLabel>
            <SidebarGroupContent>
              <Accordion type="multiple" className="w-full">
                {categories.parents.map((cat) => {
                  const Icon = getCategoryIcon(cat.name);
                  const children = categories.childrenByParent.get(cat.id) ?? [];
                  const parentActive =
                    location.pathname === "/central" &&
                    (location.search as { cat?: string })?.cat === cat.id;
                  if (children.length === 0) {
                    return (
                      <SidebarMenu key={cat.id}>
                        <SidebarMenuItem>
                          <SidebarMenuButton asChild isActive={parentActive}>
                            <Link to="/central" search={{ cat: cat.id } as never}>
                              <Icon className="h-4 w-4" />
                              <span>{cat.name}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </SidebarMenu>
                    );
                  }
                  return (
                    <AccordionItem
                      key={cat.id}
                      value={cat.id}
                      className="border-b-0"
                    >
                      <AccordionTrigger
                        className={cn(
                          "px-2 py-1.5 text-sm font-normal hover:no-underline rounded-md hover:bg-sidebar-accent",
                          collapsed && "justify-center",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {!collapsed && <span>{cat.name}</span>}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-0 pl-2">
                        <SidebarMenu>
                          <SidebarMenuItem>
                            <SidebarMenuButton
                              asChild
                              isActive={parentActive}
                              className="text-xs text-muted-foreground"
                            >
                              <Link to="/central" search={{ cat: cat.id } as never}>
                                <span>Todos em {cat.name}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                          {children.map((child) => {
                            const childActive =
                              location.pathname === "/central" &&
                              (location.search as { cat?: string })?.cat === child.id;
                            return (
                              <SidebarMenuItem key={child.id}>
                                <SidebarMenuButton asChild isActive={childActive}>
                                  <Link
                                    to="/central"
                                    search={{ cat: child.id } as never}
                                  >
                                    <span>{child.name}</span>
                                  </Link>
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            );
                          })}
                        </SidebarMenu>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3 space-y-2">
        {!collapsed && user && (
          <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
        )}
        <Button
          asChild
          variant="ghost"
          size="sm"
          className={cn("w-full justify-start", collapsed && "justify-center px-0")}
        >
          <Link to="/categorias">
            <Tags className="h-4 w-4" />
            {!collapsed && <span className="ml-2">Categorias</span>}
          </Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className={cn("w-full justify-start", collapsed && "justify-center px-0")}
        >
          <Link to="/configuracoes">
            <Settings className="h-4 w-4" />
            {!collapsed && <span className="ml-2">Configurações</span>}
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut()}
          className={cn("w-full justify-start", collapsed && "justify-center px-0")}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Sair</span>}
        </Button>
        <p className={cn("text-[10px] text-muted-foreground", collapsed && "text-center")}>
          {collapsed ? "v1" : "Controller CMV Pro v1"}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
