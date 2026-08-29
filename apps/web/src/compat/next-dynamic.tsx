import { lazy, Suspense, type ComponentType } from "react";

type Loader<P> = () => Promise<{ default: ComponentType<P> } | ComponentType<P>>;

export default function dynamic<P extends object>(loader: Loader<P>, options?: { loading?: ComponentType; ssr?: boolean }) {
  const Lazy = lazy(async () => {
    const mod = await loader();
    return typeof mod === "function" ? { default: mod } : mod;
  });
  const Loading = options?.loading;
  return function DynamicComponent(props: P) {
    return <Suspense fallback={Loading ? <Loading /> : null}><Lazy {...props} /></Suspense>;
  };
}
