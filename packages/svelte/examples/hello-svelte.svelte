<script>
  import Child from './child.svelte';

  let name = 'World';
  let count = $state(0);

  setInterval(() => {
    count += 1;
  }, 1000);
</script>

<div>
  <div>Hello {name}!</div>
  <div>Count: {count}</div>
  <Child message="Child component works!" />
  <div>Press Ctrl+C to exit</div>
</div>
